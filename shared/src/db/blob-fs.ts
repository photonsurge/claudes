import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, statfs, unlink, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

/** What one namespace directory holds, as measured by walking it. */
export interface BlobNamespaceUsage {
  ns: string;
  files: number;
  bytes: number;
  /** Abandoned `.tmp-*` writes — reclaimable garbage, excluded from `files`/`bytes`. */
  tmpFiles: number;
  tmpBytes: number;
  largestBytes: number;
  newestMs: number | null;
  oldestMs: number | null;
}

/** The whole blob root, plus the filesystem it sits on. */
export interface BlobUsage {
  root: string;
  namespaces: BlobNamespaceUsage[];
  files: number;
  bytes: number;
  tmpFiles: number;
  tmpBytes: number;
  /** Filesystem capacity for `root`, or null if it could not be read. */
  disk: { totalBytes: number; freeBytes: number; usedBytes: number } | null;
}

/**
 * A filesystem-backed blob store rooted at a host directory that BOTH the worker
 * (writer) and public (reader) containers bind-mount — the shared `${BLOB_DIR}`
 * folder in docker-compose. It is the successor to keeping binary payloads in
 * Mongo (inline on the doc, or in a `*Data` sidecar collection): the metadata
 * still lives in Mongo, the bytes live here, keyed by the metadata doc's id.
 *
 * Why a filesystem and not Mongo: Mongo replicates + backs up + pages every byte
 * it stores, and WiredTiger reads the whole BSON doc even for a metadata-only
 * projection. Moving the (large, often regenerable) bytes to a plain shared
 * folder takes that I/O and storage entirely off the database server, and the
 * folder is trivially `rsync`-able for backup.
 *
 * Layout: `<root>/<namespace>/<shard>/<key>`, where `namespace` groups a
 * collection's blobs (e.g. `tex`, `admin-image`) and `shard` is the first byte
 * of `sha1(key)` in hex — 256 buckets so a namespace with many thousands of
 * blobs never lands them all in one directory.
 */
export class BlobFs {
  constructor(readonly root: string) {}

  /**
   * A `BlobFs` from `BLOB_DIR`, or `null` when unset — the signal to fall back to
   * pure-Mongo storage (local dev without the shared folder keeps working).
   */
  static fromEnv(): BlobFs | null {
    const root = process.env.BLOB_DIR?.trim();
    return root ? new BlobFs(root) : null;
  }

  /** Absolute path where the bytes for `(ns, key)` live. */
  filePath(ns: string, key: string): string {
    const safeKey = sanitize(key);
    const shard = createHash("sha1").update(safeKey).digest("hex").slice(0, 2);
    return join(this.root, sanitize(ns), shard, safeKey);
  }

  /**
   * Write (or atomically replace) the bytes for one key. Writes to a unique temp
   * file in the same directory then `rename`s over the target, so a reader never
   * observes a half-written blob and a crash mid-write leaves the old copy intact.
   */
  async put(ns: string, key: string, data: Buffer): Promise<void> {
    const file = this.filePath(ns, key);
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(tmp, data);
      await rename(tmp, file);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  /** Bytes for one key, or `null` if the file is absent. */
  async get(ns: string, key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.filePath(ns, key));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Bytes for many keys in parallel, keyed by key; misses are simply omitted. */
  async getMany(ns: string, keys: string[]): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>();
    await Promise.all(
      keys.map(async (k) => {
        const b = await this.get(ns, k);
        if (b) out.set(k, b);
      }),
    );
    return out;
  }

  /** Whether bytes exist for this key (cheaper than reading them). */
  async has(ns: string, key: string): Promise<boolean> {
    try {
      await access(this.filePath(ns, key));
      return true;
    } catch {
      return false;
    }
  }

  /** Remove the bytes for these keys; missing files are not an error. */
  async delete(ns: string, keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async (k) => {
        try {
          await unlink(this.filePath(ns, k));
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
      }),
    );
  }

  /**
   * Walk the whole root and measure it: file count and bytes per namespace, plus
   * the capacity of the filesystem underneath. This is the only read path that
   * discovers rather than addresses — it reports whatever directories are really
   * there, so a namespace no code writes any more still shows up as the disk it
   * is still eating. A namespace that has never been written has no directory at
   * all (`put` mkdirs lazily) and is simply absent.
   *
   * Shards are walked one at a time so a namespace with tens of thousands of
   * blobs costs a bounded number of concurrent stats rather than all of them.
   */
  async usage(): Promise<BlobUsage> {
    const namespaces: BlobNamespaceUsage[] = [];
    for (const ns of await listDirs(this.root)) {
      namespaces.push(await this.namespaceUsage(ns));
    }
    namespaces.sort((a, b) => b.bytes - a.bytes);

    const sum = (pick: (n: BlobNamespaceUsage) => number) =>
      namespaces.reduce((total, n) => total + pick(n), 0);

    return {
      root: this.root,
      namespaces,
      files: sum((n) => n.files),
      bytes: sum((n) => n.bytes),
      tmpFiles: sum((n) => n.tmpFiles),
      tmpBytes: sum((n) => n.tmpBytes),
      disk: await this.diskUsage(),
    };
  }

  private async namespaceUsage(ns: string): Promise<BlobNamespaceUsage> {
    const dir = join(this.root, ns);
    const usage: BlobNamespaceUsage = {
      ns,
      files: 0,
      bytes: 0,
      tmpFiles: 0,
      tmpBytes: 0,
      largestBytes: 0,
      newestMs: null,
      oldestMs: null,
    };

    for (const shard of await listDirs(dir)) {
      const shardDir = join(dir, shard);
      const entries = await listFiles(shardDir);
      const sizes = await Promise.all(
        entries.map(async (name) => {
          try {
            const s = await stat(join(shardDir, name));
            return { name, bytes: s.size, mtimeMs: s.mtimeMs };
          } catch (err) {
            // Raced with a delete, or unreadable — it is not there to count.
            if (isNotFound(err)) return null;
            throw err;
          }
        }),
      );

      for (const entry of sizes) {
        if (!entry) continue;
        if (TMP_FILE.test(entry.name)) {
          usage.tmpFiles += 1;
          usage.tmpBytes += entry.bytes;
          continue;
        }
        usage.files += 1;
        usage.bytes += entry.bytes;
        usage.largestBytes = Math.max(usage.largestBytes, entry.bytes);
        usage.newestMs = Math.max(usage.newestMs ?? entry.mtimeMs, entry.mtimeMs);
        usage.oldestMs = Math.min(usage.oldestMs ?? entry.mtimeMs, entry.mtimeMs);
      }
    }

    return usage;
  }

  private async diskUsage(): Promise<BlobUsage["disk"]> {
    try {
      const s = await statfs(this.root);
      const totalBytes = s.blocks * s.bsize;
      const freeBytes = s.bavail * s.bsize;
      return { totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
    } catch {
      return null;
    }
  }
}

/** `put` writes `<file>.tmp-<pid>-<uuid>` then renames; leftovers are dead bytes. */
const TMP_FILE = /\.tmp-\d+-[0-9a-f-]+$/i;

async function listDirs(dir: string): Promise<string[]> {
  return (await listEntries(dir)).filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listFiles(dir: string): Promise<string[]> {
  return (await listEntries(dir)).filter((e) => e.isFile()).map((e) => e.name);
}

async function listEntries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
}

/** Keep keys/namespaces to a safe, traversal-proof file-name charset. */
function sanitize(part: string): string {
  const cleaned = part.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error(`BlobFs: unsafe path component ${JSON.stringify(part)}`);
  }
  return cleaned;
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

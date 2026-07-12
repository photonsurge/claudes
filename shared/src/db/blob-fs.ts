import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";

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

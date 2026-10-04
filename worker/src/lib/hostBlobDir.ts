/**
 * Where a script run on the HOST should write blobs so the containers see them.
 *
 * docker-compose bind-mounts `${BLOB_DIR:-./blobs}` (relative to the repo root)
 * at /app/blobs in the worker and public containers, and sets BLOB_DIR to
 * /app/blobs inside them. A script run on the host (`yarn speak`) has no such
 * mount, so:
 *
 *  - BLOB_DIR set to a host path that exists → use it (root .env set it for compose too).
 *  - BLOB_DIR unset, or the container path /app/blobs that does not exist here →
 *    the compose default, `<repo>/blobs`.
 *
 * The folder must be writable: compose's blob-init chowns it to uid 1001, so a
 * host user may not be able to write. Then null is returned with the reason, and
 * the caller falls back to storing the bytes in Mongo (the page still plays them).
 */
import { accessSync, constants, existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export const CONTAINER_BLOB_DIR = "/app/blobs";

export interface HostBlobDir {
  dir: string | null;
  reason: string;
}

export function resolveHostBlobDir(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot = resolve(__dirname, "../../.."),
  fs: { exists: (p: string) => boolean; writable: (p: string) => boolean } = {
    exists: existsSync,
    writable: (p) => {
      try {
        accessSync(p, constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
  },
): HostBlobDir {
  const raw = env.BLOB_DIR?.trim();
  const fromEnv = raw && raw !== CONTAINER_BLOB_DIR ? (isAbsolute(raw) ? raw : resolve(repoRoot, raw)) : null;
  const dir = fromEnv && fs.exists(fromEnv) ? fromEnv : resolve(repoRoot, "blobs");
  if (!fs.exists(dir)) return { dir: null, reason: `${dir} does not exist (start the stack once so blob-init creates it)` };
  if (!fs.writable(dir)) return { dir: null, reason: `${dir} is not writable by you (blob-init owns it as uid 1001: sudo chmod -R a+rwX ${dir})` };
  return { dir, reason: fromEnv && dir === fromEnv ? "BLOB_DIR" : "compose default ./blobs" };
}

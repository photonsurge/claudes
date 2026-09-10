/**
 * One-off maintenance jobs triggered from the /admin/jobs panel. Each export is
 * a BullMQ handler discovered as `maintenance.<fn>` (see index.ts loader).
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { migrateFrameBlobs as runFrameBlobMigration } from "../weather/frameBlobMigrate";
import { migrateBlobs as runBlobMigration } from "../blob/migrate";
import { runOrphanSweep } from "../blob/orphans";

/**
 * Externalise the WeatherFrame + WeatherForecastFrame texture bytes into their
 * `*Data` sidecar collections so history metadata scans stop paging the texture
 * archive through Mongo. Idempotent + crash-safe; the first run is heavy (reads
 * every inline blob once). Registry id `frame-blobs-migrate`.
 */
export async function migrateFrameBlobs(_job: Job) {
  const db = await getAppDb();
  return runFrameBlobMigration(db);
}

/**
 * Externalise every Mongo-stored blob (baked textures, frame archives, aurora/
 * geomag/satimg caches, ad + admin-image uploads) onto the shared `${BLOB_DIR}`
 * folder, taking the binary archive off the database server. Copy-and-verify then
 * drop, so it's crash-safe on precious upload data; idempotent; no-op without
 * `BLOB_DIR`. Registry id `blobs-migrate`. Same as `yarn migrate:blobs`.
 */
export async function migrateBlobs(_job: Job) {
  const db = await getAppDb();
  return runBlobMigration(db);
}

/**
 * Report (or, with `data.apply`, delete) blobs on disk that no metadata doc
 * references. Every read path goes doc -> blob, so an orphan is invisible and
 * permanent; a prune that died between the two writes, or an interrupted
 * migration, leaves them behind. Report-only unless explicitly applied.
 * Registry ids `blobs-orphans` / `blobs-orphans-purge`.
 * See ../blob/orphans.ts and docs/blob-retention-plan.md.
 */
export async function sweepOrphanBlobs(job: Job) {
  const apply = job?.data?.data?.apply === true;
  const db = await getAppDb();
  return runOrphanSweep(db, { apply });
}

/**
 * Measure the shared blob folder and cache the result for /api/admin/files.
 *
 * The walk is a `stat` per blob across the whole tree. That was fine when the
 * folder was small and fatal once it was not: doing it inline in the admin
 * request outlived the reverse proxy's read timeout, so the page got the proxy's
 * HTML error page instead of JSON. Heavy work belongs here, not in public.
 * Registry id `blobs-measure`; also runs on a schedule.
 */
export async function measureBlobs(_job: Job) {
  const db = await getAppDb();
  if (!db.blobFs) return { skipped: true, reason: "BLOB_DIR not set" };
  const started = Date.now();
  const usage = await db.blobFs.usage();
  const tookMs = Date.now() - started;
  await db.blobUsage.save(usage, tookMs);
  return {
    files: usage.files,
    bytes: usage.bytes,
    namespaces: usage.namespaces.length,
    tmpFiles: usage.tmpFiles,
    freeBytes: usage.disk?.freeBytes ?? null,
    tookMs,
  };
}

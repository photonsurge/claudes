/**
 * One-off maintenance jobs triggered from the /admin/jobs panel. Each export is
 * a BullMQ handler discovered as `maintenance.<fn>` (see index.ts loader).
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { migrateFrameBlobs as runFrameBlobMigration } from "../weather/frameBlobMigrate";
import { migrateBlobs as runBlobMigration } from "../blob/migrate";

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

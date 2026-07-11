/**
 * One-off maintenance jobs triggered from the /admin/jobs panel. Each export is
 * a BullMQ handler discovered as `maintenance.<fn>` (see index.ts loader).
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { migrateFrameBlobs as runFrameBlobMigration } from "../weather/frameBlobMigrate";

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

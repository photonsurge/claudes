/**
 * One-shot migration — `yarn migrate:frame-blobs`. Thin CLI wrapper over
 * `migrateFrameBlobs` (worker/src/weather/frameBlobMigrate.ts), which is also the
 * `maintenance.migrateFrameBlobs` admin-Jobs button. Moves the WeatherFrame +
 * WeatherForecastFrame texture bytes into their `*Data` sidecar collections so
 * `listMeta` history scans stop paging the texture archive through Mongo.
 * Idempotent + crash-safe — see the lib for the rationale.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { migrateFrameBlobs } from "../weather/frameBlobMigrate";

(async () => {
  const db = await getAppDb();
  const res = await migrateFrameBlobs(db);
  console.log(
    `all done — ${res.total} frame(s) externalised (frames ${res.frame}, forecast ${res.forecast}).`,
  );
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("frameBlobMigrate fatal:", err);
  process.exit(1);
});

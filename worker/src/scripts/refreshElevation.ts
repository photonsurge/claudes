/**
 * Manual one-shot elevation-relief bake — `yarn refresh:elevation`.
 *
 * Thin wrapper around the shared core `ingestElevation()` (worker/src/weather/
 * elevation.ts), which is the SAME code the admin "Bake elevation relief" button
 * runs. This wrapper just owns the process lifecycle (connection teardown + exit)
 * the way the in-worker handler must not.
 *
 * Config (env, all optional): ELEVATION_DEM_PATH (local GeoTIFF, skips the
 * ~466 MB download), ELEVATION_DEM_URL (remote source), ELEVATION_BAKE_WIDTH /
 * ELEVATION_BAKE_HEIGHT (output grid, default 2160×1080).
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { ingestElevation } from "../weather/elevation";

(async () => {
  const res = await ingestElevation();
  console.log("elevation bake:", res);
  const db = await getAppDb();
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshElevation fatal:", err);
  process.exit(1);
});

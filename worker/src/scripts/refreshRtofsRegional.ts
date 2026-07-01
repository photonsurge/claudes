/**
 * Manual one-shot RTOFS regional-window nests ingest — `yarn refresh:rtofs-regional`.
 * Thin wrapper around `ingestRtofsRegional()` (worker/src/weather/rtofsRegional.ts),
 * the same function the scheduled BullMQ job calls. Downloads each RTOFS regional
 * GRIB2 window, bakes sst/current/salinity on the window's own grid, and publishes
 * one run per window (model="rtofs-<region>"). Needs network to NOMADS + `wgrib2`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestRtofsRegional } from "../weather/rtofsRegional";

(async () => {
  console.log("refresh:rtofs-regional —", await ingestRtofsRegional());
  process.exit(0);
})().catch((err) => {
  console.error("refreshRtofsRegional fatal:", err);
  process.exit(1);
});

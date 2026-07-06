/**
 * Manual one-shot NOAA Global RTOFS temperature-at-depth ingest —
 * `yarn refresh:rtofs-depth`. Thin wrapper around `ingestRtofsDepth()`
 * (worker/src/weather/rtofsDepth.ts), which the scheduled BullMQ job also
 * calls: netCDF (816MB, nowcast only) → `cdo -sellevel -remapbil` per depth →
 * wgrib2 extract → bake 4 depth-chapter textures, published as
 * model="rtofs-depth". Needs network to NOMADS + `cdo` + `wgrib2`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestRtofsDepth } from "../weather/rtofsDepth";

(async () => {
  console.log("refresh:rtofs-depth —", await ingestRtofsDepth());
  process.exit(0);
})().catch((err) => {
  console.error("refreshRtofsDepth fatal:", err);
  process.exit(1);
});

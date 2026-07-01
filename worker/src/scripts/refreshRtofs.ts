/**
 * Manual one-shot NOAA Global RTOFS ocean ingest — `yarn refresh:rtofs`.
 * Thin wrapper around `ingestRtofs()` (worker/src/weather/multiSource.ts), which
 * the scheduled BullMQ job also calls: netCDF → `cdo -f grb2 -remapbil` → wgrib2
 * extract → bake SST/salinity/currents, published as model="rtofs".
 * Needs network to NOMADS + `cdo` + `wgrib2`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestRtofs } from "../weather/multiSource";

(async () => {
  console.log("refresh:rtofs —", await ingestRtofs());
  process.exit(0);
})().catch((err) => {
  console.error("refreshRtofs fatal:", err);
  process.exit(1);
});

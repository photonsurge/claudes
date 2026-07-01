/**
 * Manual one-shot NOAA HRRR (CONUS) nest ingest — `yarn refresh:hrrr`.
 * Thin wrapper around `ingestHrrr()` (worker/src/weather/hrrr.ts), the same
 * function the scheduled BullMQ job calls. Fetches the NOMADS HRRR filtered
 * GRIB2, wgrib2-regrids Lambert→regular over CONUS, bakes temp/wind/gust,
 * publishes model="hrrr". Needs network to NOMADS + `wgrib2`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestHrrr } from "../weather/hrrr";

(async () => {
  console.log("refresh:hrrr —", await ingestHrrr());
  process.exit(0);
})().catch((err) => {
  console.error("refreshHrrr fatal:", err);
  process.exit(1);
});

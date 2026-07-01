/**
 * Manual one-shot DWD ICON-D2 (Europe) nest ingest — `yarn refresh:icon-d2`.
 * Thin wrapper around `ingestIconD2()` (worker/src/weather/iconD2.ts), the same
 * function the scheduled BullMQ job calls. Fetches the DWD .bz2 regular-lat-lon
 * fields, bunzip2 + wgrib2 onto the descriptor grid, bakes temp/wind/gust,
 * publishes model="icon-d2". Needs network to opendata.dwd.de + `wgrib2`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestIconD2 } from "../weather/iconD2";

(async () => {
  console.log("refresh:icon-d2 —", await ingestIconD2());
  process.exit(0);
})().catch((err) => {
  console.error("refreshIconD2 fatal:", err);
  process.exit(1);
});

/**
 * Manual one-shot ECMWF IFS ingest — `yarn refresh:ifs`.
 * Thin wrapper around `ingestIfs()` (worker/src/weather/multiSource.ts), which the
 * scheduled BullMQ job also calls. Publishes model="ifs" (temp/wind/pressure on
 * the 1440×721 grid). Needs network to data.ecmwf.int + a CCSDS-capable wgrib2.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestIfs } from "../weather/multiSource";

(async () => {
  console.log("refresh:ifs —", await ingestIfs());
  process.exit(0);
})().catch((err) => {
  console.error("refreshIfs fatal:", err);
  process.exit(1);
});

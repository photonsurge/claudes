/**
 * Manual one-shot NOAA MRMS radar (CONUS) nest ingest — `yarn refresh:mrms`.
 * Thin wrapper around `ingestMrms()` (worker/src/weather/mrms.ts), the same
 * function the scheduled BullMQ job calls. Fetches the latest MRMS reflectivity
 * .gz, gunzip + wgrib2 subset over CONUS, bakes the nest-only `radar` variable
 * (clear-air transparent), publishes model="mrms". Needs network + `wgrib2`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestMrms } from "../weather/mrms";

(async () => {
  console.log("refresh:mrms —", await ingestMrms());
  process.exit(0);
})().catch((err) => {
  console.error("refreshMrms fatal:", err);
  process.exit(1);
});

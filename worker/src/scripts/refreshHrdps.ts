/**
 * Manual one-shot ECCC HRDPS 2.5km Canada nest ingest — `yarn refresh:hrdps`.
 * Thin wrapper around `ingestHrdps()` (worker/src/weather/hrdps.ts), the same
 * function the scheduled BullMQ job calls.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestHrdps } from "../weather/hrdps";

(async () => {
  console.log("refresh:hrdps —", await ingestHrdps());
  process.exit(0);
})().catch((err) => {
  console.error("refreshHrdps fatal:", err);
  process.exit(1);
});

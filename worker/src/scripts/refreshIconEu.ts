/**
 * Manual one-shot DWD ICON-EU 6.5km all-Europe nest ingest — `yarn refresh:iconEu`.
 * Thin wrapper around `ingestIconEu()` (worker/src/weather/iconEu.ts), the same
 * function the scheduled BullMQ job calls.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestIconEu } from "../weather/iconEu";

(async () => {
  console.log("refresh:iconEu —", await ingestIconEu());
  process.exit(0);
})().catch((err) => {
  console.error("refreshIconEu fatal:", err);
  process.exit(1);
});

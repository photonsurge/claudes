/**
 * Manual one-shot DWD ICON global 13km worldwide nest ingest — `yarn refresh:iconGlobal`.
 * Thin wrapper around `ingestIconGlobal()` (worker/src/weather/iconGlobal.ts), the same
 * function the scheduled BullMQ job calls.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestIconGlobal } from "../weather/iconGlobal";

(async () => {
  console.log("refresh:iconGlobal —", await ingestIconGlobal());
  process.exit(0);
})().catch((err) => {
  console.error("refreshIconGlobal fatal:", err);
  process.exit(1);
});

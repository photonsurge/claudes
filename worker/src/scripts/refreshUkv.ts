/**
 * Manual one-shot Met Office UKV 2km UK (free AWS) nest ingest — `yarn refresh:ukv`.
 * Thin wrapper around `ingestUkv()` (worker/src/weather/ukv.ts), the same
 * function the scheduled BullMQ job calls.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestUkv } from "../weather/ukv";

(async () => {
  console.log("refresh:ukv —", await ingestUkv());
  process.exit(0);
})().catch((err) => {
  console.error("refreshUkv fatal:", err);
  process.exit(1);
});

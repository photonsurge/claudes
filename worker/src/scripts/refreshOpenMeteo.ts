/**
 * Manual one-shot Open-Meteo `.om` spatial nests ingest — `yarn refresh:openmeteo`.
 * Thin wrapper around `ingestOpenMeteo()` (worker/src/weather/openMeteo.ts), the
 * same function the scheduled BullMQ job calls. Loops every enabled OM_MODELS
 * entry (JMA Japan now; AU/CN/KR one-line adds).
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { ingestOpenMeteo } from "../weather/openMeteo";

(async () => {
  console.log("refresh:openmeteo —", await ingestOpenMeteo());
  process.exit(0);
})().catch((err) => {
  console.error("refreshOpenMeteo fatal:", err);
  process.exit(1);
});

// Kick the real GFS pipeline on demand (instead of waiting for RUN_CHECK_CRON).
//
// Enqueues `weather.check`, which finds the latest complete GFS run and, if it's
// newer than what's published, enqueues `weather.ingest`. The worker must be
// running (`yarn dev`) AND `wgrib2` must be on PATH for ingest to succeed.
//
//   cd worker && yarn check
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { sendToQueue } from "@photonsurge/shared/bull/bull-queue";

(async () => {
  const domain = process.env.APP_DOMAIN || "default";
  const job = await sendToQueue(domain, "weather", "check", {});
  console.log(`[check] enqueued weather.check job id=${job.id}`);
  setTimeout(() => process.exit(0), 250);
})().catch((err) => {
  console.error("[check] failed:", err);
  process.exit(1);
});

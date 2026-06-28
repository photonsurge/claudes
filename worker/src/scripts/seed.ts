// Enqueue a one-off `weather.seedSample` job.
//
// Builds a synthetic, published weather run (no NOMADS / no wgrib2) so the
// globe at /watch renders immediately. The worker must be running (`yarn dev`)
// to pick the job up.
//
//   cd worker && yarn seed
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { sendToQueue } from "@photonsurge/shared/bull/bull-queue";

(async () => {
  const domain = process.env.APP_DOMAIN || "default";
  const job = await sendToQueue(domain, "weather", "seedSample", {});
  console.log(`[seed] enqueued weather.seedSample job id=${job.id}`);
  // Give BullMQ a tick to flush the write, then exit.
  setTimeout(() => process.exit(0), 250);
})().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});

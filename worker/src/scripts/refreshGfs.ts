/**
 * Manual one-shot GFS base ingest — `yarn refresh:gfs`.
 *
 * GFS is the ONLY source of rain / storm(CAPE) / cloud / snow / pressure (and the
 * fallback for temp/wind/humidity/gust/sst). Normally it only runs through the
 * queue (`weather.check` → `weather.ingest`), which needs a healthy worker+Redis
 * and is easy to miss. This wrapper resolves the latest available GFS cycle and
 * bakes it directly — same core (`runIngest`) the scheduled job calls — so it
 * populates reliably and slots into `yarn refresh:all`. Needs network + wgrib2.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { latestAvailableRun } from "../sources/gfs";
import { headOk } from "../weather/download";
import { runIngest } from "../weather/ingest";

(async () => {
  const latest = await latestAvailableRun(new Date(), headOk);
  console.log(`refresh:gfs — ingesting GFS ${latest.date} ${latest.cycle}z …`);
  // runIngest reads date/cycle from job.data.data — build a minimal synthetic job.
  const job = { data: { data: { date: latest.date, cycle: latest.cycle } } } as unknown as Job;
  console.log("refresh:gfs —", await runIngest(job));
  process.exit(0);
})().catch((err) => {
  console.error("refreshGfs fatal:", err);
  process.exit(1);
});

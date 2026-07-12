// weather/check.ts
// `check` handler internals: determine the latest available GFS run and, if it is
// newer than the latest published run, enqueue an ingest job. Otherwise no-op.

import type { Job } from "bullmq";

import { getAppDb } from "@photonsurge/shared/db/index";
import { sendToQueue } from "@photonsurge/shared/bull/bull-queue";
import { log } from "@photonsurge/shared/utill/logger";

import { latestAvailableRun, type LatestRun } from "../sources/gfs";
import { headOk } from "./download";
import { cfg } from "./config";

const TAG = "job:weather";
const DOMAIN = "weather";

/**
 * Determine the latest available GFS run; if it is newer than the latest
 * published run in the DB, enqueue an ingest job. Otherwise no-op.
 */
export async function runCheck(_job: Job) {
  const { model } = cfg();
  const db = await getAppDb();

  const latest: LatestRun = await latestAvailableRun(new Date(), headOk);
  // Compare against the latest published GFS run specifically — NOT the global
  // latest across all models. The multi-supplier fleet (ifs/rtofs/mrms…)
  // publishes newer runs continuously, so the global latest is almost always
  // some other model and this check would never see GFS as "newer", starving
  // both the GFS render and the forecast archive it feeds.
  const published = await db.latestPublishedRunForModel(model);
  const publishedTime = published?.run ? new Date(published.run).getTime() : 0;

  if (latest.runDate.getTime() <= publishedTime) {
    log(TAG, "check: up to date", { latest: latest.runDate.toISOString() });
    return { upToDate: true, latest: latest.runDate.toISOString() };
  }

  log(TAG, "check: newer run available -> enqueue ingest", {
    date: latest.date,
    cycle: latest.cycle,
  });
  await sendToQueue(DOMAIN, "weather", "ingest", {
    date: latest.date,
    cycle: latest.cycle,
    model,
  });
  return { enqueued: true, date: latest.date, cycle: latest.cycle };
}

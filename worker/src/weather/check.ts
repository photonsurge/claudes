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
import { recentPendingRun } from "./inflight";

const TAG = "job:weather";
const DOMAIN = "weather";

export interface CheckOptions {
  /**
   * Rebake the latest AVAILABLE cycle even when it is already published (the
   * "Remake weather" button). The enqueued ingest carries `force: true`, which
   * makes it bake a fresh run doc alongside the still-live one and let the atomic
   * publish + retention swap it in — so the map never goes blank (unlike the old
   * delete-first path). A normal scheduled check leaves this false and no-ops
   * when up to date.
   */
  force?: boolean;
}

/**
 * Determine the latest available GFS run; if it is newer than the latest
 * published run in the DB (or `force`), enqueue an ingest job. Otherwise no-op.
 */
export async function runCheck(_job: Job, opts: CheckOptions = {}) {
  const { model } = cfg();
  const { force = false } = opts;
  const db = await getAppDb();

  const latest: LatestRun = await latestAvailableRun(new Date(), headOk);
  // Compare against the latest published GFS run specifically — NOT the global
  // latest across all models. The multi-supplier fleet (ifs/rtofs/mrms…)
  // publishes newer runs continuously, so the global latest is almost always
  // some other model and this check would never see GFS as "newer", starving
  // both the GFS render and the forecast archive it feeds.
  const published = await db.latestPublishedRunForModel(model);
  const publishedTime = published?.run ? new Date(published.run).getTime() : 0;

  if (!force && latest.runDate.getTime() <= publishedTime) {
    log(TAG, "check: up to date", { latest: latest.runDate.toISOString() });
    return { upToDate: true, latest: latest.runDate.toISOString() };
  }

  // Dedupe: if a bake for this exact cycle is already in flight, don't enqueue a
  // second ingest — this is what stops the repeatable check (or a rapid Remake)
  // stacking duplicate `weather.ingest` jobs while the first is still running.
  // Applies to forced rebakes too: one bake at a time per cycle.
  const inFlight = await recentPendingRun(db, model, latest.runDate);
  if (inFlight) {
    log(TAG, "check: ingest already in flight for this cycle, not enqueuing", {
      latest: latest.runDate.toISOString(),
      inFlightRunId: inFlight.id,
    });
    return { inFlight: true, latest: latest.runDate.toISOString(), force };
  }

  log(TAG, `check: ${force ? "forced rebake" : "newer run available"} -> enqueue ingest`, {
    date: latest.date,
    cycle: latest.cycle,
    force,
  });
  await sendToQueue(DOMAIN, "weather", "ingest", {
    date: latest.date,
    cycle: latest.cycle,
    model,
    force,
  });
  return { enqueued: true, date: latest.date, cycle: latest.cycle, force };
}

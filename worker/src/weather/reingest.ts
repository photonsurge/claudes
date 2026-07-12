// weather/reingest.ts
// Admin "Remake weather for maps" button internals: force a clean re-bake of the
// GFS weather that feeds every map-type overlay (temp/wind/rain/cloud…) AND the
// rolling 3-day forecast store.
//
// BAKE-THEN-SWAP: this does NOT delete the current GFS run up front. It kicks
// `check` with `force`, which enqueues an ingest for the latest available cycle
// even when that cycle is already published. That ingest bakes a FRESH run doc
// while the old one stays live and on the map; the atomic publish (published
// flips LAST) + retention then swap the new run in. So clicking "Remake" can
// never blank the map or lose GFS mid-bake — the previous delete-first path did
// both (a multi-minute blackout of every GFS layer, and total loss of GFS if two
// clicks/checks interleaved). `weather-clear-gfs` remains for a genuine wipe.

import type { Job } from "bullmq";

import { log } from "@photonsurge/shared/utill/logger";

import { blogInfo, blogErr } from "../blog";
import { summarizeForLog } from "../utils";
import { runCheck } from "./check";
import { cfg } from "./config";

const TAG = "job:weather";

export interface ReingestResult {
  check: Awaited<ReturnType<typeof runCheck>>;
}

/**
 * Force a re-bake of the latest available GFS cycle without disturbing the live
 * run. Delegates to `check` with `force: true`; the enqueued ingest bakes a new
 * run doc and the atomic publish swaps it in, so the map stays populated the
 * whole time.
 */
export async function runReingest(job: Job): Promise<ReingestResult> {
  const { model } = cfg();
  try {
    const check = await runCheck(job, { force: true });
    log(TAG, "reingest: forced rebake enqueued", { model, check });
    blogInfo(
      TAG,
      `Remake weather: force re-baking the latest ${model} cycle ` +
        `(the current run stays live until the new one publishes)`,
      { model, check },
      "weather",
      "reingest",
    );
    return { check };
  } catch (err) {
    log(TAG, "reingest failed", { err: summarizeForLog(err) });
    blogErr(TAG, "Remake weather failed", err, "weather", "reingest");
    throw err;
  }
}

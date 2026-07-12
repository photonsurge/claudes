// weather/reingest.ts
// Admin "Remake weather for maps" button internals: force a clean re-bake of the
// GFS weather that feeds every map-type overlay (temp/wind/rain/cloud…) AND the
// rolling 3-day forecast store.
//
// Deletes the stored GFS runs (model-scoped — IFS/RTOFS/radar and the rest of
// the multi-source portfolio are left untouched, unlike the `yarn reingest`
// script's blanket deleteMany) and then runs the normal `check`. Because the
// clear leaves no published GFS run, `check` always sees the latest available
// cycle as "newer" and enqueues a full ingest — so the cycle re-bakes even when
// it was already published (which a plain `check` would skip as up-to-date).

import type { Job } from "bullmq";

import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";

import { blogInfo, blogErr } from "../blog";
import { summarizeForLog } from "../utils";
import { clearModelRuns, type ClearResult } from "./clear";
import { runCheck } from "./check";
import { cfg } from "./config";

const TAG = "job:weather";

export interface ReingestResult {
  cleared: ClearResult;
  check: Awaited<ReturnType<typeof runCheck>>;
}

/**
 * Clear the stored runs for the configured base model (GFS), then kick `check`
 * so the latest cycle re-bakes from scratch. The clear MUST happen first: it is
 * what makes the re-bake fire even when the current cycle is already published
 * (`check` compares against the latest published GFS run, which the clear
 * removes).
 */
export async function runReingest(job: Job): Promise<ReingestResult> {
  const { model } = cfg();
  try {
    const db = await getAppDb();
    const cleared = await clearModelRuns(db, model);
    log(TAG, "reingest: cleared model runs", { model, ...cleared });
    const check = await runCheck(job);
    blogInfo(
      TAG,
      `Remake weather: cleared ${cleared.clearedRunIds.length} ${model} run(s) + ` +
        `${cleared.deletedTextureCount} texture(s); re-baking latest cycle`,
      { model, cleared, check },
      "weather",
      "reingest",
    );
    return { cleared, check };
  } catch (err) {
    log(TAG, "reingest failed", { err: summarizeForLog(err) });
    blogErr(TAG, "Remake weather failed", err, "weather", "reingest");
    throw err;
  }
}

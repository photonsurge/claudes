// weather/clear.ts
// Delete every stored run (+ its baked textures) for one source model, so the
// globe shows no overlay for that model until the next ingest bakes a fresh run.
// This is the manual-button counterpart to the `yarn reset:weather` script, but
// scoped to a single model (e.g. "gfs") and WITHOUT auto-re-kicking the fleet —
// the operator runs "Check weather run" afterwards to rebake.
//
// The long-term WeatherFrame archive is deliberately NOT touched (frames are
// never pruned, so point history / replay keep working). Texture-then-run delete
// order mirrors retention.ts.

import type { Job } from "bullmq";

import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";

import { blogInfo, blogErr } from "../blog";
import { summarizeForLog } from "../utils";

const TAG = "job:weather";

export interface ClearDb {
  weatherRuns: {
    getAll: (
      query?: any,
      opts?: any,
    ) => Promise<{ success: boolean; data?: Array<{ id: string }> }>;
    deleteByID: (id: string) => Promise<{ success: boolean }>;
  };
  weatherTextures: {
    deleteMany: (query: any) => Promise<{ success: boolean; data?: { count: number } }>;
  };
}

export interface ClearResult {
  clearedRunIds: string[];
  deletedTextureCount: number;
}

/**
 * Delete all runs for `model` and their textures. Loads the run ids first, then
 * deletes each run's textures (`deleteMany({ runId })`) before the run doc, so a
 * partial failure never orphans textures behind a still-present run.
 */
export async function clearModelRuns(db: ClearDb, model: string): Promise<ClearResult> {
  const all = await db.weatherRuns.getAll({ model }, { sort: { run: -1 } });
  const runs = all.data ?? [];

  // Loud: this is a destructive wipe of a whole model's runs (Remake/Clear-GFS
  // button, or a reset script). If GFS maps vanish, this line in the log is the
  // culprit — it names exactly what was deleted and how many.
  if (runs.length) {
    log(TAG, `clear: DELETING ${runs.length} ${model} run(s)`, { model, runIds: runs.map((r) => r.id) });
  }

  let deletedTextureCount = 0;
  const clearedRunIds: string[] = [];
  for (const r of runs) {
    const del = await db.weatherTextures.deleteMany({ runId: r.id });
    deletedTextureCount += del.data?.count ?? 0;
    await db.weatherRuns.deleteByID(r.id);
    clearedRunIds.push(r.id);
  }
  return { clearedRunIds, deletedTextureCount };
}

/** Job handler internals: `weather.clearGfs` — the admin "Clear GFS data" button. */
export async function runClearGfs(_job: Job): Promise<ClearResult> {
  try {
    const db = await getAppDb();
    const result = await clearModelRuns(db, "gfs");
    log(TAG, "clearGfs done", result);
    blogInfo(
      TAG,
      `GFS data cleared: ${result.clearedRunIds.length} run(s) + ${result.deletedTextureCount} texture(s)`,
      result,
      "weather",
      "clearGfs",
    );
    return result;
  } catch (err) {
    log(TAG, "clearGfs failed", { err: summarizeForLog(err) });
    blogErr(TAG, "GFS clear failed", err, "weather", "clearGfs");
    throw err;
  }
}

// weather/retention.ts
// Pure selection logic for run retention, plus the IO-bound prune executor.

import { log } from "@photonsurge/shared/utill/logger";
import type { iWeatherRunModel } from "@photonsurge/shared/db/weather-run-model";

import { INGEST_STALE_MS } from "./inflight";

const TAG = "job:weather";

export interface PrunableRun {
  id: string;
  run: Date | string;
  published: boolean;
}

/**
 * Given runs and a keep count, return the runs that should be pruned: keep the
 * newest `keep` PUBLISHED runs (by run time) and prune everything older.
 * Non-published runs are never counted toward the keep budget, but stale
 * non-published runs older than the oldest kept published run are pruned too.
 */
export function runsToPrune<T extends PrunableRun>(runs: T[], keep: number): T[] {
  const time = (r: T) => new Date(r.run).getTime();
  const published = runs.filter((r) => r.published).sort((a, b) => time(b) - time(a));
  const kept = published.slice(0, Math.max(0, keep));
  const keptIds = new Set(kept.map((r) => r.id));

  if (keep <= 0) {
    // Keep nothing: prune every published run.
    return runs.filter((r) => r.published);
  }

  // Oldest kept run time defines the retention cutoff.
  const cutoff = kept.length > 0 ? time(kept[kept.length - 1]) : Infinity;

  return runs.filter((r) => {
    if (keptIds.has(r.id)) return false;
    if (r.published) return true; // published but not in the kept set
    // Non-published: prune only if there IS a published run to anchor the cutoff
    // (finite) AND this run is older than it. When a group has NO published run
    // (cutoff = Infinity) EVERY non-published run would otherwise qualify — which
    // deletes the run being baked RIGHT NOW during the first bake after a clear
    // (retention fires on every publish, incl. mrms every 2 min). That is the bug
    // where GFS "appeared then vanished". Keep them; the first successful publish
    // establishes a finite cutoff that then cleans up genuine leftovers.
    return Number.isFinite(cutoff) && time(r) < cutoff;
  });
}

export interface RetentionDb {
  weatherRuns: {
    getAll: (
      query?: any,
      opts?: any,
    ) => Promise<{ success: boolean; data?: iWeatherRunModel[] }>;
    deleteByID: (id: string) => Promise<{ success: boolean }>;
  };
  weatherTextures: {
    deleteMany: (query: any) => Promise<{ success: boolean; data?: { count: number } }>;
  };
}

export interface RetentionResult {
  prunedRunIds: string[];
  deletedTextureCount: number;
}

/**
 * Execute retention: load all runs, compute which to prune, delete their
 * textures then the run docs. `keep` is the number of newest published runs to
 * retain PER MODEL — so IFS/RTOFS/wave-mosaic runs don't evict each other or the
 * GFS base (each supplier keeps its own newest `keep`). Single-model behaviour is
 * unchanged.
 */
export async function runRetention(db: RetentionDb, keep: number): Promise<RetentionResult> {
  const all = await db.weatherRuns.getAll({}, { sort: { run: -1 } });
  const runs = (all.data ?? []) as iWeatherRunModel[];
  // Prune within each model independently, then flatten the per-model lists.
  const byModel = new Map<string, iWeatherRunModel[]>();
  for (const r of runs) {
    const m = r.model ?? "gfs";
    (byModel.get(m) ?? byModel.set(m, []).get(m)!).push(r);
  }
  const now = Date.now();
  const toPrune = [...byModel.values()]
    .flatMap((group) =>
      runsToPrune(
        group.map((r) => ({ id: r.id, run: r.run, published: r.published, _doc: r })),
        keep,
      ),
    )
    // Never prune an IN-FLIGHT bake: a recently-created `pending` run is actively
    // baking (retention can fire from a 2-min mrms publish mid-bake). This guards
    // the create→first-publish window that the finite-cutoff rule alone leaves
    // open. A stale pending doc (older than INGEST_STALE_MS = a crashed bake) is
    // still prunable, so nothing wedges.
    .filter((r) => {
      const doc = (r as any)._doc as iWeatherRunModel | undefined;
      if (doc?.status === "pending" && doc.created) {
        if (now - new Date(doc.created).getTime() < INGEST_STALE_MS) return false;
      }
      return true;
    });

  // Loud when a prune ever touches the base model — the GFS run vanishing after
  // publish was blamed on retention, so make any GFS prune impossible to miss in
  // the logs (with the run times, keep budget, and which model triggered it).
  if (toPrune.length) {
    const byModelPruned: Record<string, string[]> = {};
    for (const r of toPrune) {
      const doc = (r as any)._doc as iWeatherRunModel | undefined;
      const m = doc?.model ?? "?";
      (byModelPruned[m] ??= []).push(new Date(r.run as any).toISOString());
    }
    log(TAG, `retention: pruning ${toPrune.length} run(s) (keep=${keep})`, byModelPruned);
  }

  let deletedTextureCount = 0;
  const prunedRunIds: string[] = [];
  for (const r of toPrune) {
    const del = await db.weatherTextures.deleteMany({ runId: r.id });
    deletedTextureCount += del.data?.count ?? 0;
    await db.weatherRuns.deleteByID(r.id);
    prunedRunIds.push(r.id);
  }
  return { prunedRunIds, deletedTextureCount };
}

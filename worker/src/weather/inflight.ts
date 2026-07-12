// weather/inflight.ts
// Concurrency guard shared by `check` (enqueue side) and `ingest` (bake side):
// is an ingest for THIS exact model+cycle already in flight? Without it, the
// repeatable `check` re-fires every few minutes while a ~10-min bake is still
// running — and because no run is PUBLISHED yet, each check enqueues ANOTHER
// ingest for the same cycle, so two/three duplicate bakes pile up (the observed
// "weather.ingest ×2 for {gfs,20260712,18}" queue). The idempotency skip only
// catches an already-PUBLISHED cycle, not one that is mid-bake.
//
// A run doc is `pending` for the whole bake and only flips `complete` at publish,
// so a recent pending doc == a live bake. The staleness cutoff is essential: a
// pending doc left behind by a CRASHED bake (worker OOM mid-run) must NOT wedge
// the pipeline forever — older than the cutoff, it is ignored and a fresh ingest
// proceeds.

/** A bake older than this (no publish) is treated as a crashed leftover, not live. */
export const INGEST_STALE_MS = 20 * 60 * 1000; // 20 min — covers a full ~11-min run

export interface InflightDb {
  weatherRuns: {
    getAll: (
      query?: any,
      opts?: any,
    ) => Promise<{ success: boolean; data?: Array<{ id: string; created?: Date | string }> }>;
  };
}

/**
 * The in-flight `pending` run for `model` at `runDate`, or null. Returns a doc
 * only when a pending run exists AND was created within `staleMs` (a live bake);
 * an older pending doc (crashed leftover) returns null so it can never block a
 * new ingest.
 */
export async function recentPendingRun(
  db: InflightDb,
  model: string,
  runDate: Date,
  staleMs: number = INGEST_STALE_MS,
  now: number = Date.now(),
): Promise<{ id: string; created?: Date | string } | null> {
  const res = await db.weatherRuns.getAll(
    { model, run: runDate, status: "pending" },
    { sort: { created: -1 }, limit: 1 },
  );
  const doc = res.success && res.data && res.data.length ? res.data[0] : null;
  if (!doc) return null;
  const startedMs = doc.created ? new Date(doc.created).getTime() : 0;
  if (startedMs && now - startedMs < staleMs) return doc;
  return null;
}

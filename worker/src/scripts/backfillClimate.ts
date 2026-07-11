/**
 * Manual all-city climate backfill — `yarn backfill:climate`. Loops the same
 * batched sweep the worker crons weekly (past-year ERA5 for every city ≥ the
 * population floor, deduped to 0.1° keys → Mongo), in-process, printing each
 * batch, so the director PAST YEAR / monthly-climate panel has a nearby cached
 * point everywhere without waiting out the Sunday schedule. Re-runnable: fresh
 * points (<6 days) are skipped, so a stopped run resumes where it left off.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { backfillClimateBatch } from "../jobs/climate";

const minPop = Number(process.env.CLIMATE_BACKFILL_POP_FLOOR || 100_000);
const batchSize = Math.min(Math.max(Number(process.env.CLIMATE_BACKFILL_BATCH) || 100, 10), 500);
const gapMs = Number(process.env.CLIMATE_BACKFILL_GAP_MS || 150);

(async () => {
  const db = await getAppDb();
  let total = 0;
  let batch = 0;
  for (;;) {
    batch++;
    const r = await backfillClimateBatch(db, { minPop, batchSize, gapMs });
    total += r.fetched;
    console.log(
      `batch ${batch}: keys=${r.keys} stale=${r.stale} fetched=${r.fetched} failed=${r.failed} remaining=${r.remaining}`,
    );
    // Done, or an upstream outage fetched nothing — stop rather than spin.
    if (r.remaining === 0 || r.fetched === 0) break;
  }
  console.log(`backfill done: ${total} point(s) cached; climate docs in Mongo: ${await db.climateYears.count()}`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("backfillClimate fatal:", err);
  process.exit(1);
});

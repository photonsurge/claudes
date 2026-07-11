/**
 * One-shot — `yarn migrate:track-indexes`. Reconciles Mongo's indexes with the
 * current schema on the two big tracks collections, dropping any the schema no
 * longer declares and (re)building the ones it does.
 *
 * Why: Mongoose NEVER drops indexes on its own. `track-snapshot-model.ts` was
 * slimmed to two secondary indexes (kind+batchAt, and the batchAt TTL) — its
 * old unique `id` and `loc` 2dsphere indexes were removed from the schema but
 * stay live in Mongo. On the highest-volume collection in the DB that's pure
 * write amplification: every insert of a ~13k-row frame AND every TTL delete
 * maintains those dead indexes (the slow-query logs show ~5 index keys written
 * per doc where the schema only asks for 3). Reconciling drops them.
 *
 * Safe + idempotent: it only drops what the schema doesn't declare and only
 * creates what's missing (the declared ones already exist, so this run just
 * drops — no expensive index build on the big collection). Re-running is a
 * no-op. `diffIndexes()` is logged first so you can see exactly what will change.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Model } from "mongoose";
import { getAppDb } from "@photonsurge/shared/db/index";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function reconcile(label: string, model: Model<any>): Promise<void> {
  const live = (await model.collection.indexes()).map((i: { name?: string }) => i.name).filter(Boolean);
  console.log(`${label}: ${live.length} index(es) live — ${live.join(", ")}`);

  const diff = await model.diffIndexes();
  if (!diff.toDrop.length && !diff.toCreate.length) {
    console.log(`${label}: already in sync — nothing to do.\n`);
    return;
  }
  if (diff.toDrop.length) console.log(`${label}: dropping stale → ${diff.toDrop.join(", ")}`);
  if (diff.toCreate.length) console.log(`${label}: creating missing → ${JSON.stringify(diff.toCreate)}`);

  const dropped = await model.syncIndexes();
  console.log(`${label}: syncIndexes done (dropped: ${JSON.stringify(dropped)}).\n`);
}

(async () => {
  const db = await getAppDb();
  await reconcile("TrackSnapshot", db.trackSnapshots.model as unknown as Model<any>);
  await reconcile("Vehicle", db.vehicles.model as unknown as Model<any>);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("syncTrackIndexes fatal:", err);
  process.exit(1);
});

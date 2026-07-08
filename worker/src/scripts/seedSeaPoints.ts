/**
 * Manual one-shot ocean-monitoring-point seed — `yarn seed:sea-points`. Inserts
 * whichever entries of the curated catalog (currents/features + Niño
 * boxes/Atlantic MDR/North Sea/Med/Indian Ocean Dipole,
 * `shared/src/director-sea-points.ts#SEED_SEA_POINTS`) aren't already in the
 * DB, keyed on `pointId`. Only inserts — never overwrites an existing point —
 * so it's safe to re-run after adding new catalog entries without clobbering
 * live admin edits (e.g. an operator disabling one at `/admin/sea-points`).
 *
 *   cd worker && yarn seed:sea-points
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { SEED_SEA_POINTS } from "@photonsurge/shared/director-sea-points";

(async () => {
  const db = await getAppDb();
  const existing = new Set((await db.seaPoints.list()).map((p) => p.pointId));
  const missing = SEED_SEA_POINTS.filter((p) => !existing.has(p.pointId));
  for (const p of missing) {
    await db.seaPoints.upsertOne(p);
  }
  console.log(`[seed:sea-points] done: ${missing.length} new points inserted (${existing.size} already present)`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seedSeaPoints fatal:", err);
  process.exit(1);
});

/**
 * One-shot diagnostic for the auto-director pipeline. Reads the live Mongo the
 * worker uses and prints: persisted director configs, which scenes are in auto,
 * and — for each auto scene — the candidate pool + the next selected segment.
 * Run: `yarn ts-node src/scripts/checkDirector.ts`
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { selectNext } from "@photonsurge/shared/director-select";
import { buildCandidates } from "../director/candidates";

(async () => {
  const db = await getAppDb();

  const all = await db.directorConfig.getAll({}, { limit: 0 });
  console.log("\n=== director configs in Mongo ===");
  for (const c of (all.data ?? []) as any[]) {
    console.log(`  scene=${c.id}  mode=${c.mode}  hold(country)=${c.kindHoldSeconds?.country ?? "?"}s  minQuakeMag=${c.minQuakeMag}  minSev=${c.minAlertSeverity}`);
  }
  if (!(all.data ?? []).length) console.log("  (none — no scene has ever had its director config saved)");

  const autoScenes = await db.autoDirectorScenes();
  console.log("\n=== scenes in AUTO ===", autoScenes.length ? autoScenes : "(none)");

  for (const sceneId of autoScenes) {
    const cfg = await db.getOrInitDirectorConfig(sceneId);
    const pool = await buildCandidates(db, cfg);
    console.log(`\n--- scene "${sceneId}": ${pool.length} candidates ---`);
    const top = [...pool].sort((a, b) => b.score - a.score).slice(0, 8);
    for (const c of top) console.log(`  ${String(c.score).padStart(5)}  ${c.segment.kind.padEnd(7)} ${c.segment.id}  "${c.segment.title}"`);
    const next = selectNext(pool, { history: [] });
    console.log(`  → selectNext: ${next?.kind} "${next?.title}" @`, next?.camera);
  }

  console.log("\n(done)");
  process.exit(0);
})().catch((err) => {
  console.error("checkDirector failed:", err);
  process.exit(1);
});

/**
 * Manual one-shot — `yarn seed:short-scenes`. Creates the two scenes scripted
 * short videos play on; see director/short-scenes-seed.ts for the rules (the
 * admin "Seed short video scenes" button runs the same code).
 *
 * Existing scenes are skipped. Pass --force to re-apply the preset look.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { seedShortScenes } from "../director/short-scenes-seed";

(async () => {
  const force = process.argv.includes("--force");
  const db = await getAppDb();

  const { scenes } = await seedShortScenes(db, { force });
  for (const s of scenes) {
    const hint = s.outcome === "skipped" || s.outcome === "marked hidden" ? " (use --force to re-apply the look)" : "";
    console.log(`scene ${s.id}: ${s.outcome}${hint}`);
  }

  console.log("short scenes seeded. Tune them on /admin/scenes/shorts and /admin/scenes/shorts-preview.");
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seedShortScenes fatal:", err);
  process.exit(1);
});

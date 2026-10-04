/**
 * Manual one-shot — `yarn seed:short-format`. Creates the default short format
 * and its hidden scene (`shorts`); see director/short-format-seed.ts for the
 * rules (the admin "Seed default short format" button runs the same code).
 *
 * Existing things are skipped. Pass --force to re-apply the seed look.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { seedShortFormat } from "../director/short-format-seed";

(async () => {
  const force = process.argv.includes("--force");
  const db = await getAppDb();

  const r = await seedShortFormat(db, { force });
  const hint = r.scene === "skipped" || r.scene === "marked short" ? " (use --force to re-apply the look)" : "";
  console.log(`scene ${r.id}: ${r.scene}${hint}`);
  console.log(`format "${r.name}" settings: ${r.settings}`);

  console.log(`default short format seeded. Its look is tuned on /admin/scenes/${r.id} until the format editor lands; it plays on /watch/${r.id}.`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seedShortFormat fatal:", err);
  process.exit(1);
});

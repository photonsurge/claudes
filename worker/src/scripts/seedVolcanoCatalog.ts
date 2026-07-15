/**
 * Manual one-shot volcano-catalog seed — `yarn seed:volcano-catalog`.
 *
 * Runs the whole P7 catalog chain in the required order:
 *   1. migrate       — drop the 14-day TTL (otherwise every seeded volcano
 *                      silently expires) + backfill `bulletinAt`. Safe to re-run.
 *   2. seed          — every GVP volcano (~1,196 Holocene; +~1,451 Pleistocene
 *                      with VOLCANO_INCLUDE_PLEISTOCENE=true) + full dossier.
 *   3. seedEruptions — the ~11,089-row eruption history.
 *
 * Keyless and idempotent — re-running never duplicates, never resets a volcano's
 * live status and never wipes enrichment. Use this to populate without waiting on
 * the worker cron or restarting it.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { migrate, seed, seedEruptions } from "../jobs/volcanoCatalog";

const job = (data: Record<string, unknown> = {}) => ({ id: "manual", data: { data } }) as unknown as Job;

(async () => {
  console.log("→ migrating volcanoes to a permanent catalog (dropping the TTL)…");
  console.log("  ", await migrate(job()));

  console.log("→ seeding the GVP volcano catalog…");
  console.log("  ", await seed(job()));

  console.log("→ seeding the GVP eruption history…");
  console.log("  ", await seedEruptions(job()));

  const db = await getAppDb();
  console.log("volcanoes in Mongo:", await db.volcanoes.count());
  console.log("eruptions in Mongo:", await db.volcanoEruptions.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seedVolcanoCatalog fatal:", err);
  process.exit(1);
});

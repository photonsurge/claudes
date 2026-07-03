/**
 * Manual one-shot notable-tracks seed — `yarn seed:notable`. Thin CLI wrapper
 * over the shared core (worker/src/jobs/notable.ts#seedNotable), the same code the
 * admin/queue job runs. Upserts the curated catalog (Air Force One, famous ships,
 * research vessels…) WITHOUT clobbering worker-enriched fields, so it's safe to
 * re-run after editing shared/tracks/notable-seed.ts.
 *
 *   cd worker && yarn seed:notable
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { seedNotable } from "../jobs/notable";

(async () => {
  const result = await seedNotable();
  console.log(`[seed:notable] done: ${result.seeded} notable tracks upserted`);
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("seedNotable fatal:", err);
  process.exit(1);
});

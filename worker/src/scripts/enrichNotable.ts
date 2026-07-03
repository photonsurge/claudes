/**
 * Manual one-shot notable-tracks enrichment — `yarn enrich:notable [--force]`.
 * Thin CLI wrapper over the shared core (worker/src/jobs/notable.ts#runNotableEnrich),
 * the same code the repeatable job + admin button run.
 *
 * For every enabled catalog entry it caches a photo (planespotters for aircraft,
 * else the Wikipedia lead image) + a short Wikipedia blurb + type/operator (read
 * from the aircraftMeta cache) onto the doc, so the on-air Track Info card reads
 * Mongo, never an upstream API. Incremental (skips entries enriched within 30
 * days unless `--force`) and gently paced.
 *
 *   cd worker && yarn enrich:notable          # stale-only
 *   cd worker && yarn enrich:notable --force  # re-fetch everything
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runNotableEnrich } from "../jobs/notable";

(async () => {
  const result = await runNotableEnrich({ force: process.argv.includes("--force") });
  console.log(
    `[enrich:notable] done: ${result.enriched} updated (${result.withPhoto} with a photo) of ${result.candidates}`,
  );
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("enrichNotable fatal:", err);
  process.exit(1);
});

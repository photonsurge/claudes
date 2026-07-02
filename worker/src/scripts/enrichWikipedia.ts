/**
 * Manual one-shot Wikipedia enrichment — `yarn enrich:wiki [minPopulation] [limit]`.
 * Thin CLI wrapper over the shared core (worker/src/jobs/cities.ts#runWikiEnrich),
 * the same code the admin "Enrich cities (Wikipedia)" button runs.
 *
 * For prominent cities (population ≥ minPopulation, default 100k, plus every
 * capital) it caches the Wikipedia title, thumbnail URL and short extract onto
 * the City doc so the broadcast overlay reads Mongo, never Wikipedia at request
 * time. Incremental (skips cities enriched within 30 days unless `--force`).
 *
 *   cd worker && yarn enrich:wiki            # all ≥100k + capitals, stale-only
 *   cd worker && yarn enrich:wiki 500000 200 # ≥500k, at most 200 this run
 *   cd worker && yarn enrich:wiki 0 --force  # re-fetch everything already known
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runWikiEnrich } from "../jobs/cities";

(async () => {
  const minPop = Number(process.argv[2]);
  const limitArg = Number(process.argv[3]);
  const result = await runWikiEnrich({
    minPopulation: Number.isFinite(minPop) ? minPop : undefined,
    limit: Number.isFinite(limitArg) ? limitArg : undefined,
    force: process.argv.includes("--force"),
  });
  console.log(
    `[enrich:wiki] done: ${result.enriched} enriched (${result.withPhoto} with a photo), ${result.noMatch} no match`,
  );
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("enrichWikipedia fatal:", err);
  process.exit(1);
});

/**
 * Manual one-shot volcano Wikipedia enrichment — `yarn enrich:volcanoes [--force]`.
 * Thin CLI wrapper over the shared core (worker/src/jobs/volcanoes.ts#runVolcanoWikiEnrich),
 * the same code the repeatable job runs.
 *
 * Caches a Wikipedia photo + short blurb onto each active volcano doc, so the
 * click-to-select info card reads Mongo, never Wikipedia directly. Incremental
 * (skips volcanoes enriched within 30 days unless `--force`) and gently paced.
 *
 *   cd worker && yarn enrich:volcanoes          # stale-only
 *   cd worker && yarn enrich:volcanoes --force  # re-fetch everything
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runVolcanoWikiEnrich } from "../jobs/volcanoes";

(async () => {
  const result = await runVolcanoWikiEnrich({ force: process.argv.includes("--force") });
  console.log(
    `[enrich:volcanoes] done: ${result.enriched} updated (${result.withPhoto} with a photo) of ${result.candidates}`,
  );
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("enrichVolcanoes fatal:", err);
  process.exit(1);
});

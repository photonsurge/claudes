/**
 * Manual one-shot region Wikipedia enrichment — `yarn enrich:regions [--force]`.
 * Thin CLI wrapper over the shared core (worker/src/jobs/regions.ts#runRegionWikiEnrich).
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runRegionWikiEnrich } from "../jobs/regions";

(async () => {
  const result = await runRegionWikiEnrich({ force: process.argv.includes("--force") });
  console.log(
    `[enrich:regions] done: ${result.enriched} updated (${result.withPhoto} with a photo) of ${result.candidates}`,
  );
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("enrichRegions fatal:", err);
  process.exit(1);
});

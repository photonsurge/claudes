/**
 * Manual one-shot country Wikipedia/Wikidata enrichment — `yarn enrich:countries [--force]`.
 * Thin CLI wrapper over the shared core (worker/src/jobs/countries.ts#runCountryWikiEnrich).
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runCountryWikiEnrich } from "../jobs/countries";

(async () => {
  const result = await runCountryWikiEnrich({ force: process.argv.includes("--force") });
  console.log(
    `[enrich:countries] done: ${result.enriched} updated (${result.withPhoto} with a photo) of ${result.candidates}`,
  );
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("enrichCountries fatal:", err);
  process.exit(1);
});

/**
 * Manual one-shot region PLACES enrichment — `yarn enrich:region-places`.
 * Recomputes each land region's member countries + biggest cities from the
 * curated relations (region-membership.ts) + the Country/City catalogs. Thin CLI
 * wrapper over worker/src/jobs/regions.ts#runRegionPlaces. Run `yarn
 * seed:countries`/`seed:cities` first.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runRegionPlaces } from "../jobs/regions";

(async () => {
  const result = await runRegionPlaces();
  console.log(
    `[enrich:region-places] done: ${result.regions} land regions (${result.withCountries} w/ countries, ${result.withCities} w/ cities)`,
  );
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("enrichRegionPlaces fatal:", err);
  process.exit(1);
});

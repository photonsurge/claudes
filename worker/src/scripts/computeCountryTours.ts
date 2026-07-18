/**
 * Manual one-shot country spotlight-tour computation — `yarn tours:countries`.
 * Recomputes each country's camera tour (population-weighted centre + biggest
 * city per compass sector) from the Country + City catalogs. Thin CLI wrapper
 * over worker/src/jobs/countries.ts#runCountryTours. Run `yarn
 * seed:countries`/`seed:cities` first.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runCountryTours } from "../jobs/countries";

(async () => {
  const result = await runCountryTours();
  console.log(
    `[tours:countries] done: ${result.withTour}/${result.countries} countries with a tour (${result.noCities} no cities)`,
  );
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("computeCountryTours fatal:", err);
  process.exit(1);
});

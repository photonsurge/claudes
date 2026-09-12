// Fill the IANA `timezone` onto city docs seeded before the field existed — the
// source of the on-air LOCAL TIME row on country / alert / seismic / volcano
// cuts. Thin CLI wrapper over the shared core (worker/src/jobs/cities.ts
// #backfillTimezones), the same code the admin "Backfill city timezones" button
// runs. A pure field fill: Wikipedia enrichment and everything else survive.
//
//   cd worker && yarn backfill:city-timezones                    # finest dump (covers every tier)
//   CITIES_GEONAMES=cities15000 yarn backfill:city-timezones     # smaller download
//   CITIES_TZ_FORCE=1           yarn backfill:city-timezones     # rewrite zones that are already set
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { backfillTimezones } from "../jobs/cities";

(async () => {
  const tier = process.env.CITIES_GEONAMES;
  const force = process.env.CITIES_TZ_FORCE === "1";
  const result = await backfillTimezones({ data: { data: { tier, force } } } as never);
  console.log(
    `[backfillCityTimezones] ${result.updated} filled from ${result.tier}, ` +
      `${result.unmatched} unmatched, ${result.remaining} still without a zone`,
  );
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("[backfillCityTimezones]", err);
  process.exit(1);
});

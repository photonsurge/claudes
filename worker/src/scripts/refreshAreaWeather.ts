/**
 * Manual one-shot area-weather run — `yarn refresh:area-weather`. Computes and
 * appends an hourly-style snapshot for every seeded Country/Region right now,
 * without waiting out the cron. Requires `yarn seed:countries`/`seed:regions`
 * to have run first, and at least one temp/gust/rain WeatherFrame ingested.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runAreaWeather } from "../jobs/areaWeather";

(async () => {
  const res = await runAreaWeather();
  console.log("area-weather run:", res);
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshAreaWeather fatal:", err);
  process.exit(1);
});

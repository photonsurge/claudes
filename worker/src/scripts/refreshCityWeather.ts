/**
 * Manual one-shot city-weather cache refresh — `yarn refresh:city-weather`.
 * Samples the frame archive + forecast store at every city with population ≥
 * 100k and caches a 24h trend + current + 3-day forecast. Requires cities seeded
 * and temp/wind/rain/gust frames + forecast frames ingested.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { runCityWeather } from "../jobs/cityWeather";

(async () => {
  const res = await runCityWeather();
  console.log("city-weather refresh:", res);
  await (await getAppDb()).conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshCityWeather fatal:", err);
  process.exit(1);
});

/**
 * Manual one-shot forecast backfill — `yarn forecast:backfill`. Walks every
 * published WeatherRun still in Mongo and copies its steps into the rolling
 * WeatherForecastFrame collection, the same way `archive:backfill` seeds the
 * long-term history archive. Idempotent (newer run wins per validTime), so
 * re-running is safe. Use it once after deploying the forecast feature so
 * the strip has data immediately instead of waiting for the next GFS cycle.
 * The same logic backs the admin "Backfill 3-day forecast" job button.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { backfillForecastFromPublishedRuns } from "../weather/archiveForecast";

(async () => {
  const db = await getAppDb();
  console.log("forecast-backfilling from published runs…");
  const { runsProcessed, written } = await backfillForecastFromPublishedRuns(db as any);
  console.log(
    `done: ${written} frame(s) written across ${runsProcessed} run(s); forecast store now holds ${await db.weatherForecastFrames.count()}`,
  );
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("forecastBackfill fatal:", err);
  process.exit(1);
});

// jobs/forecast.ts
// Manual forecast-store maintenance, exposed as an admin "run now" button.
// Kept out of jobs/weather.ts (a different `type`) so the weather-map trigger
// drift guard (weather/triggerableJobs.test.ts, which asserts every "weather"
// button matches a scheduled per-source ingest event) doesn't have to know
// about it — this isn't a per-source ingest, it's a one-shot maintenance task.

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { backfillForecastFromPublishedRuns } from "../weather/archiveForecast";

/** See ../weather/archiveForecast.ts */
export async function backfill(_job: Job) {
  const db = await getAppDb();
  return backfillForecastFromPublishedRuns(db as any);
}

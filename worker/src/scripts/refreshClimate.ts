/**
 * Manual one-shot climate refresh — `yarn refresh:climate`. Runs the same
 * focus-driven snapshot the worker crons (current camera + significant
 * quakes → past-year ERA5 per point into Mongo) and prints the totals. Use it
 * to seed the cache without waiting out the worker schedule.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { snapshotClimate } from "../jobs/climate";

(async () => {
  const res = await snapshotClimate({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("climate snapshot:", res);
  const db = await getAppDb();
  console.log("climate docs in Mongo:", await db.climateYears.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshClimate fatal:", err);
  process.exit(1);
});

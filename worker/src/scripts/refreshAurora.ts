/**
 * Manual one-shot aurora refresh — `yarn refresh:aurora`. Pulls NOAA SWPC's
 * OVATION Prime grid, bakes the glow PNG into Mongo once, and prints the totals.
 * Use this to seed the cache without waiting out the worker cron.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refresh } from "../jobs/aurora";

(async () => {
  const res = await refresh({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("aurora refresh:", res);
  const db = await getAppDb();
  console.log("frames in Mongo:", await db.aurora.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshAurora fatal:", err);
  process.exit(1);
});

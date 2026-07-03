/**
 * Manual one-shot geomagnetic-field bake — `yarn refresh:geomag`. Fetches IGRF-14,
 * computes total-field intensity on a global grid, bakes the scalar texture into
 * Mongo once, and prints the range. Use this to seed the cache without waiting out
 * the (slow) worker cron.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refresh } from "../jobs/geomag";

(async () => {
  const res = await refresh({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("geomag refresh:", res);
  const db = await getAppDb();
  console.log("frames in Mongo:", await db.geomag.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshGeomag fatal:", err);
  process.exit(1);
});

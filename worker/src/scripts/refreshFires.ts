/**
 * Manual one-shot active-fire snapshot — `yarn refresh:fires`. Pulls NASA FIRMS
 * detections into Mongo once and prints the totals. Needs FIRMS_MAP_KEY set. Use
 * this to seed the cache without waiting out the worker cron.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { snapshot } from "../jobs/fires";

(async () => {
  const res = await snapshot({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("fires snapshot:", res);
  const db = await getAppDb();
  console.log("fires in Mongo:", await db.fires.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshFires fatal:", err);
  process.exit(1);
});

/**
 * Manual one-shot active-volcano snapshot — `yarn refresh:volcanoes`. Pulls NASA
 * EONET's currently-active volcano events into Mongo once and prints the
 * totals. Keyless — use this to seed the cache without waiting out the worker
 * cron or restarting it.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { snapshot } from "../jobs/volcanoes";

(async () => {
  const res = await snapshot({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("volcanoes snapshot:", res);
  const db = await getAppDb();
  console.log("volcanoes in Mongo:", await db.volcanoes.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshVolcanoes fatal:", err);
  process.exit(1);
});

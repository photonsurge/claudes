/**
 * Manual one-shot plate-boundary refresh — `yarn refresh:faults`. Pulls the Bird
 * (2003) PB2002 tectonic plate-boundary GeoJSON into Mongo once and prints the
 * totals. Use this to seed the cache without waiting out the worker cron.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refresh } from "../jobs/faults";

(async () => {
  const res = await refresh({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("faults refresh:", res);
  const db = await getAppDb();
  console.log("totals in Mongo:", await db.faults.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshFaults fatal:", err);
  process.exit(1);
});

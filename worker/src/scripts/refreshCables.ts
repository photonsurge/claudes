/**
 * Manual one-shot submarine-cable refresh — `yarn refresh:cables`. Pulls the
 * TeleGeography cable + landing GeoJSON into Mongo once and prints the totals.
 * Use this to seed the cache without waiting out the weekly worker cron.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refresh } from "../jobs/cables";

(async () => {
  const res = await refresh({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("cables refresh:", res);
  const db = await getAppDb();
  console.log("totals in Mongo:", await db.cables.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshCables fatal:", err);
  process.exit(1);
});

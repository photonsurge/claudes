/**
 * Manual one-shot capId resolve — `yarn refresh:alert-capids`. Resolves WMO
 * capurls to the canonical national CAP identifier so the same warning arriving
 * from WMO and MeteoAlarm can be merged on an exact key.
 *
 * Cap how many it fetches in one go: `yarn refresh:alert-capids 50`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refresh } from "../jobs/alertCapId";

(async () => {
  const budget = Number(process.argv[2]) || undefined;
  const res = await refresh({ id: "manual", data: { data: { budget } } } as unknown as Job);
  console.log("capId sync:", res);
  const db = await getAppDb();
  console.log("totals in Mongo:", await db.capIds.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshAlertCapIds fatal:", err);
  process.exit(1);
});

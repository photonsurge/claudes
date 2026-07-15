/**
 * Manual one-shot dissolve — `yarn refresh:alert-blobs`. Unions touching warning
 * areas of the same hazard+severity into single shapes so the globe shows weather
 * blobs instead of one square per county.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refresh } from "../jobs/alertBlobs";

(async () => {
  const res = await refresh({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("alert blobs:", res);
  const db = await getAppDb();
  console.log("totals in Mongo:", await db.alertBlobs.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshAlertBlobs fatal:", err);
  process.exit(1);
});

/**
 * Manual one-shot track snapshot — `yarn snapshot:tracks`. Records one frame of
 * aircraft (+ ships if AISSTREAM_API_KEY) into Mongo and prints the totals.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { snapshot } from "../jobs/tracks";

(async () => {
  const res = await snapshot({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("snapshot:", res);
  const db = await getAppDb();
  console.log(`total snapshots in Mongo: ${await db.trackSnapshots.count()}`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("snapshotTracks fatal:", err);
  process.exit(1);
});

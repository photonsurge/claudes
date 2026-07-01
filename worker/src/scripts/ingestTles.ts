/**
 * Manual one-shot TLE ingest — `yarn ingest:tles`. Delegates to the worker job
 * (tracks.ingestTles), which fetches the configured Celestrak groups, upserts
 * their TLEs into Mongo, and joins SATCAT metadata, then prints the stored count.
 * Use this to warm the cache without waiting out the worker cron.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { ingestTles } from "../jobs/tracks";

(async () => {
  const res = await ingestTles({ id: "manual", data: { data: {} } } as unknown as Job);
  console.log("ingestTles:", JSON.stringify(res.results, null, 2));
  const db = await getAppDb();
  console.log(`\nstored TLEs in Mongo: ${await db.satelliteTles.count()}`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("ingestTles fatal:", err);
  process.exit(1);
});

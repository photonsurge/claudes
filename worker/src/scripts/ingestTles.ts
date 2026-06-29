/**
 * Manual one-shot TLE ingest — `yarn ingest:tles`. Fetches the configured
 * Celestrak groups and upserts them into Mongo, then prints the stored count.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchGroupTle } from "@photonsurge/shared/tracks/celestrak";
import { parseTle } from "@photonsurge/shared/tracks/tle";
import { tleGroups } from "../jobs/tracks";

(async () => {
  const db = await getAppDb();
  for (const group of tleGroups()) {
    try {
      const tles = parseTle(await fetchGroupTle(group));
      const r = await db.satelliteTles.upsertMany(tles, group);
      console.log(`[${group}]`, { parsed: tles.length, ...r });
    } catch (err) {
      console.error(`[${group}] failed:`, err);
    }
  }
  console.log(`\nstored TLEs in Mongo: ${await db.satelliteTles.count()}`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("ingestTles fatal:", err);
  process.exit(1);
});

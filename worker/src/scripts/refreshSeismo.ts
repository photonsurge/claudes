/**
 * Manual one-shot seismo-station seeding — `yarn refresh:seismo`. Rebuilds the
 * global GSN broadband-station catalog so the live SeedLink loop has stations
 * to resolve focus against without waiting out the worker's daily cron.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refreshStations } from "../jobs/seismo";

(async () => {
  const fakeJob = { id: "manual", data: { data: {} } } as unknown as Job;
  console.log("stations:", await refreshStations(fakeJob));
  const db = await getAppDb();
  console.log("totals in Mongo:", { stations: await db.seismoStations.count() });
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshSeismo fatal:", err);
  process.exit(1);
});

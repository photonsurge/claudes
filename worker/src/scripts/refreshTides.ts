/**
 * Manual one-shot tide-gauge seeding — `yarn refresh:tides`. Rebuilds the global
 * IOC station catalog, then runs one focus-driven snapshot so the cache has both
 * stations and recent water-level series without waiting out the worker crons.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refreshStations, snapshotTides } from "../jobs/tides";

(async () => {
  const fakeJob = { id: "manual", data: { data: {} } } as unknown as Job;
  console.log("stations:", await refreshStations(fakeJob));
  console.log("snapshot:", await snapshotTides(fakeJob));
  const db = await getAppDb();
  console.log("totals in Mongo:", {
    stations: await db.tideStations.count(),
    series: await db.tideSeries.count(),
  });
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshTides fatal:", err);
  process.exit(1);
});

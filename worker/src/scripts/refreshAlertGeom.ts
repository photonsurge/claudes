/**
 * Manual one-shot alert-boundary sync — `yarn refresh:alert-geom`. Resolves
 * MeteoAlarm EMMA area codes to real polygons via MeteoGate and caches them, so
 * geocode-only European alerts get a footprint on the globe. Use this to seed the
 * cache without waiting out the worker cron.
 *
 * Needs METROGATE_API_KEY. Pass a budget to cap how many alerts it resolves in
 * one go (each costs two small fetches): `yarn refresh:alert-geom 50`.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { refresh } from "../jobs/alertGeom";

(async () => {
  const budget = Number(process.argv[2]) || undefined;
  const res = await refresh({ id: "manual", data: { data: { budget } } } as unknown as Job);
  console.log("alert geometry sync:", res);
  const db = await getAppDb();
  console.log("totals in Mongo:", await db.alertAreaGeom.count());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshAlertGeom fatal:", err);
  process.exit(1);
});

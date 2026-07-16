/**
 * Import GADM county boundaries into the admin-area cache — `yarn refresh:gadm`.
 * China's CMA warnings name their area ("Jinghe County") but ship no polygon; this
 * gives those names a shape so the alerts can be drawn. Matches only unambiguous
 * names, or shared names a sibling polygon can pin to a province — never guesses.
 * One-shot and idempotent; re-running refreshes in place and retro-fits stored CMA
 * alerts still missing a shape.
 *
 * LICENSE: GADM is non-commercial / no-redistribute. It is fetched here and only
 * the shapes it resolves are kept — the data is never committed or re-served. Point
 * GADM_FILE at a local unzipped .json to run offline, or GADM_URL / GADM_SOURCE_TAG
 * at an OSM county export of the same shape for a redistributable source. See
 * worker/src/alerts/gadmBoundaries.ts.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { importGadmBoundaries } from "../alerts/gadmBoundaries";

(async () => {
  const db = await getAppDb();
  const res = await importGadmBoundaries(db);
  console.log("GADM import:", res);
  console.log("admin cache:", await db.adminAreaGeom.count());
  console.log("geom coverage:", await db.alerts.geometryCoverage());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshGadm fatal:", err);
  process.exit(1);
});

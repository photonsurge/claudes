/**
 * Import NUTS administrative boundaries (Eurostat GISCO) into the admin-area
 * cache — `yarn refresh:nuts`. France (NUTS3) and Hungary (NUTS2) tag warnings
 * with a bare NUTS code and no polygon; this gives those codes a shape so the
 * alerts can be drawn. One-shot and idempotent; re-running refreshes in place and
 * retro-fits any stored alerts still missing a boundary.
 *
 * Vintage is pinned to NUTS 2013 (what the feed emits — see nutsBoundaries.ts).
 * Override with NUTS_VINTAGE / NUTS_LEVELS / NUTS_RESOLUTION if the feed changes.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { importNutsBoundaries } from "../alerts/nutsBoundaries";

(async () => {
  const db = await getAppDb();
  const res = await importNutsBoundaries(db);
  console.log("NUTS import:", res);
  console.log("admin cache:", await db.adminAreaGeom.count());
  console.log("geom coverage:", await db.alerts.geometryCoverage());
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("refreshNuts fatal:", err);
  process.exit(1);
});

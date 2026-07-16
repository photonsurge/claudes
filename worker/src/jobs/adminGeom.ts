import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { importNutsBoundaries } from "../alerts/nutsBoundaries";

const TAG = "job:admin-geom";

/**
 * Dispatched as type "adminGeom", event "refresh". Imports NUTS administrative
 * boundaries (Eurostat GISCO) into the admin-area cache so France (NUTS3) and
 * Hungary (NUTS2) warnings — which ship a bare NUTS code and no polygon — can be
 * drawn, and retro-fits any stored alerts still missing a boundary.
 *
 * One-shot and idempotent; no cron (a static nomenclature rarely changes). The
 * alerts ingest joins this cache itself — this job only populates it.
 */
export async function refresh(job: Job) {
  const db = await getAppDb();
  try {
    const r = await importNutsBoundaries(db);
    const cache = await db.adminAreaGeom.count();
    const coverage = await db.alerts.geometryCoverage();
    const result = { ...r, failures: r.failures.length, cache, coverage };
    log(TAG, `NUTS import done`, result);
    blogInfo(
      TAG,
      `NUTS boundaries: ${r.stored} stored, ${r.backfilled} alerts retro-fitted ` +
        `(${cache.areas} admin areas cached; ${coverage.alertsNoShape} alerts still invisible)`,
      result,
      "adminGeom",
      "refresh",
    );
    if (r.failures.length) {
      log(TAG, `partial failures`, { count: r.failures.length, sample: r.failures.slice(0, 5) });
    }
    return result;
  } catch (err) {
    log(TAG, `NUTS import failed`, summarizeForLog(err));
    blogErr(TAG, `NUTS import failed`, err, "adminGeom", "refresh");
    throw err;
  }
}

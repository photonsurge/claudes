import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { syncAreaGeometry } from "../alerts/geom-sync";
import { meteogateEnabled } from "../alerts/meteogate";

const TAG = "job:alert-geom";

/**
 * Dispatched as type "alertGeom", event "refresh". Fills the EMMA_ID → boundary
 * cache from MeteoGate so MeteoAlarm's geocode-only alerts can be drawn (the CAP
 * feed gives their area a name and a code, but no polygon).
 *
 * Runs on a slow cron: EMMA areas are administrative regions, so once a code is
 * resolved it never needs fetching again and a steady-state run writes nothing.
 * The alerts ingest joins this cache itself — this job only populates it.
 */
export async function refresh(job: Job) {
  if (!meteogateEnabled()) {
    log(TAG, `skipped — MeteoGate disabled or METROGATE_API_KEY unset`);
    return { skipped: true };
  }
  const db = await getAppDb();
  try {
    const budget = Number(job?.data?.data?.budget) || undefined;
    const r = await syncAreaGeometry(db, { budget });
    const totals = await db.alertAreaGeom.count();
    const result = { ...r, failures: r.failures.length, totals };
    log(TAG, `alert geometry sync done`, result);

    // Lead with what we still CAN'T draw, not with how much the run resolved.
    // The old line reported `+N cached / N resolved` — effort, not outcome — and
    // read as success while half of Europe's areas had no shape at all.
    const c = r.coverage;
    const gap = c
      ? `${c.alertsNoShape} alerts with NO location, ${c.alertsPartial} drawing partial ` +
        `(${c.areasNoGeom}/${c.areas} areas still shapeless)`
      : `coverage unknown`;
    blogInfo(
      TAG,
      `alert geometry: ${gap} — +${r.cached} areas cached, ${r.crawlPages} crawl pages, ` +
        `${r.resolved} resolved, ${r.skipped} skipped`,
      result,
      "alertGeom",
      "refresh",
    );
    if (r.failures.length) {
      log(TAG, `partial failures`, { count: r.failures.length, sample: r.failures.slice(0, 5) });
    }
    return result;
  } catch (err) {
    log(TAG, `alert geometry sync failed`, summarizeForLog(err));
    blogErr(TAG, `alert geometry sync failed`, err, "alertGeom", "refresh");
    throw err;
  }
}

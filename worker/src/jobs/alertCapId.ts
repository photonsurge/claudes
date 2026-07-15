import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { syncCapIds } from "../alerts/capid-sync";

const TAG = "job:alert-capid";

/**
 * Dispatched as type "alertCapId", event "refresh". Resolves WMO's `capurl`s to
 * the canonical national CAP identifier and caches them, so a warning arriving
 * from both WMO and MeteoAlarm can be matched on an exact key rather than a fuzzy
 * one (see docs/alert-dedup-merge-plan.md).
 *
 * The alerts ingest joins this cache itself — this job only populates it. Slow
 * cron: a capurl is content-addressed so its mapping never changes, and an
 * unresolved one merely means that alert can't merge yet.
 */
export async function refresh(job: Job) {
  const db = await getAppDb();
  try {
    const budget = Number(job?.data?.data?.budget) || undefined;
    const r = await syncCapIds(db, { budget });
    const totals = await db.capIds.count();
    const result = { ...r, failures: r.failures.length, totals };
    log(TAG, `capId sync done`, result);
    blogInfo(
      TAG,
      `alert capIds: +${r.resolved} resolved (${r.withId} with an id), ` +
        `${r.skipped} cached, ${totals.resolved}/${totals.total} known`,
      result,
      "alertCapId",
      "refresh",
    );
    if (r.failures.length) {
      log(TAG, `partial failures`, { count: r.failures.length, sample: r.failures.slice(0, 5) });
    }
    return result;
  } catch (err) {
    log(TAG, `capId sync failed`, summarizeForLog(err));
    blogErr(TAG, `capId sync failed`, err, "alertCapId", "refresh");
    throw err;
  }
}

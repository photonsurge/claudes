import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchFaultData } from "@photonsurge/shared/faults/bird";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:faults";

/**
 * Dispatched as type "faults", event "refresh". Pulls the Bird (2003) PB2002
 * tectonic plate-boundary GeoJSON and replaces the cached set in Mongo. Plate
 * boundaries are essentially fixed reference geography, so this runs on a slow
 * cron (monthly by default). The public route reads only this cached copy — the
 * app never calls the source directly.
 */
export async function refresh(_job: Job) {
  const db = await getAppDb();
  try {
    const { faults } = await fetchFaultData();
    const r = await db.faults.replace(faults);
    const result = { faults: r.faults };
    log(TAG, `faults refresh done`, result);
    blogInfo(TAG, `fault refresh: ${r.faults} plate-boundary segments`, result, "faults", "refresh");
    // Live push so the overlay refetches the instant a snapshot lands.
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "faults", count: r.faults } });
    return result;
  } catch (err) {
    log(TAG, `faults refresh failed`, summarizeForLog(err));
    blogErr(TAG, `fault refresh failed`, err, "faults", "refresh");
    throw err;
  }
}

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchCableData } from "@photonsurge/shared/cables/telegeography";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:cables";

/**
 * Dispatched as type "cables", event "refresh". Pulls TeleGeography's open
 * submarine-cable + landing-point GeoJSON and replaces the cached set in Mongo.
 * Cables are near-static reference data, so this runs on a slow cron (weekly by
 * default). The public route reads only this cached copy — the app never calls
 * TeleGeography directly.
 */
export async function refresh(_job: Job) {
  const db = await getAppDb();
  try {
    const { cables, landings } = await fetchCableData();
    const r = await db.cables.replace(cables, landings);
    const result = { cables: r.cables, landings: r.landings };
    log(TAG, `cables refresh done`, result);
    blogInfo(TAG, `cable refresh: ${r.cables} cables, ${r.landings} landings`, result, "cables", "refresh");
    // Live push so the overlay refetches the instant a snapshot lands.
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "cables", count: r.cables } });
    return result;
  } catch (err) {
    log(TAG, `cables refresh failed`, summarizeForLog(err));
    blogErr(TAG, `cable refresh failed`, err, "cables", "refresh");
    throw err;
  }
}

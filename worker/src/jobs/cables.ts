import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchCableData } from "@photonsurge/shared/cables/telegeography";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:cables";

// Skip the whole-set rewrite if the cache is younger than this. Under the weekly
// cron so a normal scheduled run still refreshes; it only suppresses the extra
// boot run (the job is registered immediately:true) so a worker restart doesn't
// re-write ~500 big path arrays every time. Override with the env; `force` (the
// manual yarn script) always refreshes.
const CABLE_MAX_AGE_MS = Number(process.env.CABLE_REFRESH_MAX_AGE_MS || 6 * 24 * 60 * 60 * 1000);

/**
 * Dispatched as type "cables", event "refresh". Pulls TeleGeography's open
 * submarine-cable + landing-point GeoJSON and replaces the cached set in Mongo.
 * Cables are near-static reference data, so this runs on a slow cron (weekly by
 * default). The public route reads only this cached copy — the app never calls
 * TeleGeography directly.
 */
export async function refresh(_job: Job) {
  const db = await getAppDb();
  const force = Boolean((_job?.data as { force?: boolean } | undefined)?.force);
  try {
    // Near-static + a heavy geometry rewrite → don't redo it on every boot.
    if (!force) {
      const newest = await db.cables.newestFetchedAt();
      if (newest && Date.now() - newest.getTime() < CABLE_MAX_AGE_MS) {
        const result = { skipped: true, ageHours: Math.round((Date.now() - newest.getTime()) / 3_600_000) };
        log(TAG, `cables cache fresh — skipping refresh`, result);
        return result;
      }
    }
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

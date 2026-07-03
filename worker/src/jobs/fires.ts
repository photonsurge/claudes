import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchFires, hasFirmsKey } from "@photonsurge/shared/fires/firms";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:fires";

/**
 * Dispatched as type "fires", event "snapshot". Pulls NASA FIRMS active-fire
 * detections (whole globe) and upserts them into Mongo on the minted detection id;
 * a TTL expires old ones. The public route reads only this cache. Requires a free
 * FIRMS_MAP_KEY — the job no-ops (doesn't throw) when it's absent so a keyless dev
 * env just runs without fires.
 */
export async function snapshot(_job: Job) {
  if (!hasFirmsKey()) {
    log(TAG, `fires snapshot skipped — FIRMS_MAP_KEY not set`);
    return { fires: 0, skipped: true };
  }
  const db = await getAppDb();
  try {
    const { fires } = await fetchFires();
    const r = await db.fires.upsertMany(fires);
    const result = { fires: fires.length, upserted: r.upserted };
    log(TAG, `fires snapshot done`, result);
    blogInfo(TAG, `fires snapshot: ${fires.length} active detections`, result, "fires", "snapshot");
    // Live push so the overlay refetches the instant a snapshot lands.
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "fires", count: fires.length } });
    return result;
  } catch (err) {
    log(TAG, `fires snapshot failed`, summarizeForLog(err));
    blogErr(TAG, `fires snapshot failed`, err, "fires", "snapshot");
    throw err;
  }
}

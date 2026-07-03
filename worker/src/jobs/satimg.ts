import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { bakeHimawari } from "../satimg/bake";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:satimg";

/**
 * Dispatched as type "satimg", event "refresh". Spawns the satpy sidecar to pull
 * the latest Himawari-9 full-disk from the open AWS bucket, reproject it onto a
 * global plate-carrée PNG, and upsert that bird's ONE cached frame in Mongo. The
 * disk refreshes every 10 min (+ ~15-20 min ingest lag), so this runs on a ~10-min
 * cron. The public route reads only the cached frame — the app never calls S3.
 *
 * OPT-IN: needs a Python venv with satpy (see WORKER.md); the scheduler only
 * registers this when SATIMG_REFRESH_ENABLED=true.
 */
export async function refresh(job: Job) {
  const satId =
    typeof job?.data?.data?.satellite === "string" ? job.data.data.satellite : "himawari9";
  const db = await getAppDb();
  try {
    const { meta, png } = await bakeHimawari({ satellite: satId });
    await db.satimg.replace({
      satId: meta.satId,
      satName: meta.satName,
      subLon: meta.subLon,
      composite: meta.composite,
      observationTime: new Date(meta.observationTime),
      bounds: meta.bounds,
      width: meta.width,
      height: meta.height,
      png,
    });
    const result = { satId: meta.satId, slot: meta.slot, composite: meta.composite, bytes: png.length };
    log(TAG, `satimg refresh done`, result);
    blogInfo(TAG, `satimg bake: ${meta.satName} ${meta.composite} @ ${meta.slot}`, result, "satimg", "refresh");
    // Live push so the overlay refetches the instant a new frame lands.
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "satimg", satId: meta.satId } });
    return result;
  } catch (err) {
    log(TAG, `satimg refresh failed`, summarizeForLog(err));
    blogErr(TAG, `satimg refresh failed (${satId})`, err, "satimg", "refresh");
    throw err;
  }
}

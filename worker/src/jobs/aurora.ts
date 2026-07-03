import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchOvation } from "@photonsurge/shared/aurora/ovation";
import { fetchKp } from "@photonsurge/shared/aurora/kp";
import { AURORA_FLOOR, AURORA_IMAGE_UNSCALE } from "@photonsurge/shared/aurora/types";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { rollLongitude, encodeAuroraScalarPng } from "../grib/encode";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:aurora";

/**
 * Dispatched as type "aurora", event "refresh". Pulls NOAA SWPC's OVATION Prime
 * auroral-probability grid, bakes it into a pre-coloured translucent glow PNG, and
 * upserts the single cached frame in Mongo. The oval moves with geomagnetic
 * activity, so this runs on a fast cron (~5 min). The public route reads only the
 * cached frame — the app never calls SWPC directly.
 */
export async function refresh(_job: Job) {
  const db = await getAppDb();
  try {
    const grid = await fetchOvation();
    // OVATION longitude is 0..360 (col 0 = 0°E); roll to -180..180 for a
    // plate-carrée PNG with bounds [-180,-90,180,90].
    const rolled = rollLongitude(grid.values, grid.width, grid.height);
    // Mask sub-floor cells to transparent so only the oval draws (nodata alpha 0).
    const keep = new Uint8Array(rolled.length);
    for (let i = 0; i < rolled.length; i++) keep[i] = rolled[i] > AURORA_FLOOR ? 1 : 0;
    const png = await encodeAuroraScalarPng(rolled, grid.width, grid.height, AURORA_IMAGE_UNSCALE, keep);

    // Kp drives the oval but comes from a separate feed — a Kp outage must not
    // fail the whole bake, so read it best-effort and leave it null on error.
    let kp: number | null = null;
    let kpTime: Date | null = null;
    try {
      const reading = await fetchKp();
      if (reading) {
        kp = reading.kp;
        kpTime = reading.time ? new Date(reading.time) : null;
      }
    } catch (kpErr) {
      log(TAG, `kp fetch failed (leaving null)`, summarizeForLog(kpErr));
    }

    await db.aurora.replace({
      observationTime: new Date(grid.observationTime),
      forecastTime: new Date(grid.forecastTime),
      bounds: [-180, -90, 180, 90],
      width: grid.width,
      height: grid.height,
      maxProb: grid.maxProb,
      kp,
      kpTime,
      png,
    });
    const result = { maxProb: grid.maxProb, kp, bytes: png.length };
    log(TAG, `aurora refresh done`, result);
    blogInfo(TAG, `aurora bake: peak ${grid.maxProb}% oval`, result, "aurora", "refresh");
    // Live push so the overlay + Kp HUD refetch the instant a new frame lands.
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "aurora", maxProb: grid.maxProb } });
    return result;
  } catch (err) {
    log(TAG, `aurora refresh failed`, summarizeForLog(err));
    blogErr(TAG, `aurora refresh failed`, err, "aurora", "refresh");
    throw err;
  }
}

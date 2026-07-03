import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { fetchGibs } from "../satimg/gibs";
import { cloudKey, cloudKeyFromEnv } from "../satimg/grade";
import { bakeHimawari } from "../satimg/bake";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:satimg";

/**
 * Dispatched as type "satimg", event "refresh". Bakes ONE cached satellite-imagery
 * frame into Mongo; the public route reads only the cache (the app never calls the
 * upstream). Two sources:
 *
 *  - "gibs" (DEFAULT): one HTTP GET of NASA GIBS' global true-color mosaic (keyless,
 *    already reprojected), cloud-keyed via sharp so clear sky is transparent and only
 *    the clouds drape over the globe. Pure Node → Docker-trivial, no Python.
 *  - "satpy": the raw Himawari-9 full-disk bake (worker/src/satimg/himawari.py). Heavy
 *    (S3 HSD download + satpy reproject) and needs a Python venv — opt-in via
 *    SATIMG_SOURCE=satpy for when you want a live geostationary disk.
 */
export async function refresh(job: Job) {
  const source = process.env.SATIMG_SOURCE ?? "gibs";
  const db = await getAppDb();
  try {
    if (source === "satpy") return await refreshSatpy(job, db);
    return await refreshGibs(db);
  } catch (err) {
    log(TAG, `satimg refresh failed`, summarizeForLog(err));
    blogErr(TAG, `satimg refresh failed (${source})`, err, "satimg", "refresh");
    throw err;
  }
}

/** GIBS global true-color → cloud-keyed frame. */
async function refreshGibs(db: Awaited<ReturnType<typeof getAppDb>>) {
  const raw = await fetchGibs();
  // Cloud-key so clear sky is transparent (the globe/weather shows through). Skip with
  // SATIMG_CLOUDKEY=false to store the opaque true-color as-is.
  const png = process.env.SATIMG_CLOUDKEY === "false" ? raw.png : await cloudKey(raw.png, cloudKeyFromEnv());
  await db.satimg.replace({
    satId: "global",
    satName: "GIBS True Color",
    subLon: 0, // N/A for a global mosaic
    composite: raw.layers[0] ?? "truecolor",
    observationTime: new Date(`${raw.date}T00:00:00Z`),
    bounds: raw.bounds,
    width: raw.width,
    height: raw.height,
    png,
  });
  const result = { satId: "global", date: raw.date, keyed: png !== raw.png, bytes: png.length };
  log(TAG, `satimg refresh done`, result);
  blogInfo(TAG, `satimg bake: GIBS true-color @ ${raw.date}`, result, "satimg", "refresh");
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "satimg", satId: "global" } });
  return result;
}

/** Raw Himawari-9 satpy bake (opt-in). */
async function refreshSatpy(job: Job, db: Awaited<ReturnType<typeof getAppDb>>) {
  const satId = typeof job?.data?.data?.satellite === "string" ? job.data.data.satellite : "himawari9";
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
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "satimg", satId: meta.satId } });
  return result;
}

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { SATIMG_FEEDS } from "@photonsurge/shared/satimg/types";
import { fetchGibsFeed } from "../satimg/gibs";
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

/** Bake every GIBS feed (global daily + live geostationary discs) → cloud-keyed frames. */
async function refreshGibs(db: Awaited<ReturnType<typeof getAppDb>>) {
  const ck = process.env.SATIMG_CLOUDKEY !== "false";
  const opts = cloudKeyFromEnv();
  const done: Array<{ feed: string; when: string; bytes: number }> = [];

  // One feed failing (upstream hiccup, a satellite in eclipse) must not sink the rest.
  for (const feed of SATIMG_FEEDS) {
    try {
      const r = await fetchGibsFeed(feed.id);
      // Cloud-key only feeds that read as clouds when keyed (the true-colour mosaic);
      // GeoColor/IR discs are shown whole and blended by their opacity. SATIMG_CLOUDKEY
      // =false disables keying entirely.
      const png = ck && r.cloudKey ? await cloudKey(r.png, opts) : r.png;
      // Guard Mongo's 16 MB BSON doc limit with a clear error instead of a raw BSON one.
      if (png.length > 15_500_000) {
        throw new Error(`frame ${(png.length / 1e6).toFixed(1)}MB > 15.5MB — lower this feed's maxPx`);
      }
      await db.satimg.replace({
        satId: feed.id,
        satName: feed.label,
        subLon: 0, // N/A for mosaics/discs
        composite: feed.id,
        observationTime: r.when === "latest" ? new Date() : new Date(`${r.when}T00:00:00Z`),
        bounds: r.bounds,
        width: r.width,
        height: r.height,
        png,
      });
      done.push({ feed: feed.id, when: r.when, bytes: png.length });
      log(TAG, `satimg feed baked`, { feed: feed.id, when: r.when, bytes: png.length });
    } catch (err) {
      log(TAG, `satimg feed failed`, { feed: feed.id, err: summarizeForLog(err) });
      blogErr(TAG, `satimg feed failed (${feed.id})`, err, "satimg", "refresh");
    }
  }

  if (!done.length) throw new Error("all satimg feeds failed");
  blogInfo(TAG, `satimg bake: ${done.length}/${SATIMG_FEEDS.length} feeds`, { done }, "satimg", "refresh");
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "satimg" } });
  return { feeds: done };
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

import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { SATIMG_FEEDS } from "@photonsurge/shared/satimg/types";
import { fetchGibsFeed, fetchDiscLook, looksFor, type GibsFeedResult } from "../satimg/gibs";
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

/**
 * Bake every satellite frame the globe can draw: the daily true-colour MOSAIC (cloud-
 * keyed), the lightning OVERLAY, and — for each geostationary DISC — one frame PER
 * available look (satId `${disc}:${look}`) so the operator's global look switches
 * instantly. Each unit is baked independently: one upstream hiccup / eclipse / missing
 * look must not sink the rest.
 */
async function refreshGibs(db: Awaited<ReturnType<typeof getAppDb>>) {
  const ck = process.env.SATIMG_CLOUDKEY !== "false";
  const opts = cloudKeyFromEnv();
  const done: Array<{ satId: string; when: string; bytes: number }> = [];

  // Store one baked frame under a satId. `keyable` gates the cloud-key to the mosaic.
  const store = async (satId: string, label: string, r: GibsFeedResult) => {
    const png = ck && r.cloudKey ? await cloudKey(r.png, opts) : r.png;
    // Guard Mongo's 16 MB BSON doc limit with a clear error instead of a raw BSON one.
    if (png.length > 15_500_000) {
      throw new Error(`frame ${(png.length / 1e6).toFixed(1)}MB > 15.5MB — lower this feed's maxPx`);
    }
    await db.satimg.replace({
      satId,
      satName: label,
      subLon: 0, // N/A for mosaics/discs
      composite: satId,
      observationTime: r.when === "latest" ? new Date() : new Date(`${r.when}T00:00:00Z`),
      bounds: r.bounds,
      width: r.width,
      height: r.height,
      png,
    });
    done.push({ satId, when: r.when, bytes: png.length });
    log(TAG, `satimg frame baked`, { satId, when: r.when, bytes: png.length });
  };

  // The full bake plan: (satId, label, fetch-thunk). Discs fan out over their looks.
  const plan: Array<{ satId: string; label: string; fetch: () => Promise<GibsFeedResult> }> = [];
  for (const feed of SATIMG_FEEDS) {
    if (feed.kind === "disc") {
      for (const look of looksFor(feed.id)) {
        plan.push({ satId: `${feed.id}:${look}`, label: `${feed.label} · ${look}`, fetch: () => fetchDiscLook(feed.id, look) });
      }
    } else {
      plan.push({ satId: feed.id, label: feed.label, fetch: () => fetchGibsFeed(feed.id) });
    }
  }

  for (const unit of plan) {
    try {
      await store(unit.satId, unit.label, await unit.fetch());
    } catch (err) {
      log(TAG, `satimg frame failed`, { satId: unit.satId, err: summarizeForLog(err) });
      blogErr(TAG, `satimg frame failed (${unit.satId})`, err, "satimg", "refresh");
    }
  }

  if (!done.length) throw new Error("all satimg frames failed");

  // Drop any stale frame not in this bake plan (renamed/removed feeds or looks — e.g.
  // the old plain `goes-east` from before the disc×look split). Guarded on a non-empty
  // plan so a bad run can't wipe the cache.
  const { removed } = await db.satimg.pruneExcept(plan.map((p) => p.satId));
  if (removed) log(TAG, `satimg pruned stale frames`, { removed });

  blogInfo(TAG, `satimg bake: ${done.length}/${plan.length} frames`, { done, pruned: removed }, "satimg", "refresh");
  emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "satimg" } });
  return { frames: done, pruned: removed };
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

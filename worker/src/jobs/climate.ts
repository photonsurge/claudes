import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchClimateYear } from "@photonsurge/shared/climate/openmeteo";
import { climateKey } from "@photonsurge/shared/climate/types";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";

const TAG = "job:climate";

/** Re-fetch a cached point after this long (a year of reanalysis barely moves). */
const MAX_AGE_MS = Number(process.env.CLIMATE_MAX_AGE_MS || 24 * 60 * 60 * 1000);
/** Politeness cap on Open-Meteo fetches per tick (most ticks fetch nothing). */
const MAX_FETCHES = Number(process.env.CLIMATE_MAX_FETCHES || 4);
/** Magnitude floor for quakes that pull their location into the cache. */
const FOCUS_MIN_MAG = Number(process.env.CLIMATE_FOCUS_MIN_MAG || 5.5);

/**
 * [lng,lat] focus points = current on-air camera + recent significant quakes
 * (their locations become on-air segments, so the panel will ask about them).
 * Mirrors the tides snapshot job.
 */
async function focusPoints(db: Awaited<ReturnType<typeof getAppDb>>): Promise<[number, number][]> {
  const pts: [number, number][] = [];
  try {
    const bs: any = await db.getOrInitBroadcastState();
    const c = bs?.camera?.center;
    if (Array.isArray(c) && c.length === 2 && c.every((n: unknown) => typeof n === "number")) {
      pts.push([c[0], c[1]]);
    }
  } catch {
    /* no broadcast state yet — fall back to quakes only */
  }
  const quakes = await db.quakes.list({ minMag: FOCUS_MIN_MAG, limit: 30 });
  for (const q of quakes) pts.push([q.lng, q.lat]);
  return pts;
}

/**
 * Dispatched as type "climate", event "snapshotClimate". Focus-driven: for each
 * point the broadcast cares about, fetch the past year of ERA5 daily climate
 * from Open-Meteo (free, no key) and cache it in Mongo — unless a fresh doc
 * (< CLIMATE_MAX_AGE_MS) already covers that 0.1° key. The public /climate
 * route reads only this cache; the browser never touches the feed.
 */
export async function snapshotClimate(_job: Job) {
  const db = await getAppDb();
  try {
    const points = await focusPoints(db);

    // Dedup to 0.1° keys, preserving focus priority (camera first).
    const wanted = new Map<string, [number, number]>();
    for (const [lng, lat] of points) {
      const key = climateKey(lat, lng);
      if (!wanted.has(key)) wanted.set(key, [lng, lat]);
    }

    let fetched = 0;
    let fresh = 0;
    for (const [key, [lng, lat]] of wanted) {
      if (fetched >= MAX_FETCHES) break;
      const at = await db.climateYears.fetchedAtByKey(key);
      if (at != null && Date.now() - at < MAX_AGE_MS) {
        fresh++;
        continue;
      }
      try {
        const year = await fetchClimateYear(lat, lng);
        if (!year) continue;
        await db.climateYears.upsert(year);
        fetched++;
      } catch (err) {
        log(TAG, `climate fetch failed for ${key}`, summarizeForLog(err));
      }
    }

    const result = { focus: points.length, keys: wanted.size, fresh, fetched };
    log(TAG, `climate snapshot done`, result);
    if (fetched > 0) {
      blogInfo(TAG, `climate: ${fetched} point(s) cached`, result, "climate", "snapshotClimate");
    }
    return result;
  } catch (err) {
    log(TAG, `climate snapshot failed`, summarizeForLog(err));
    blogErr(TAG, `climate snapshot failed`, err, "climate", "snapshotClimate");
    throw err;
  }
}

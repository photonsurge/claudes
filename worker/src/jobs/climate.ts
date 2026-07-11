import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchClimateYear } from "@photonsurge/shared/climate/openmeteo";
import { climateKey } from "@photonsurge/shared/climate/types";
import { sendToQueue, QUEUE_PRIORITY } from "@photonsurge/shared/bull/bull-queue";
import { log } from "@photonsurge/shared/utill/logger";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";

const TAG = "job:climate";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Re-fetch a cached point after this long (a year of reanalysis barely moves). */
const MAX_AGE_MS = Number(process.env.CLIMATE_MAX_AGE_MS || 24 * 60 * 60 * 1000);
/** Politeness cap on Open-Meteo fetches per tick (most ticks fetch nothing). */
const MAX_FETCHES = Number(process.env.CLIMATE_MAX_FETCHES || 4);
/** Magnitude floor for quakes that pull their location into the cache. */
const FOCUS_MIN_MAG = Number(process.env.CLIMATE_FOCUS_MIN_MAG || 5.5);
/** Only warm a frame's on-screen cities when it's actually a spotlight frame
 *  (country/region/event), not a wide/global spin — below this zoom the
 *  broadcast shows no per-city climate sparks. */
const SPOTLIGHT_ZOOM = Number(process.env.CLIMATE_SPOTLIGHT_ZOOM || 3.2);
/** How many of the framed shot's biggest cities to cache — a superset of what
 *  TopCitiesPanel / the nearby-cities panel actually spark. */
const FRAMED_CITY_LIMIT = Number(process.env.CLIMATE_FRAMED_CITIES || 12);

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
      // The on-air frame's own cities each spark /climate (TopCitiesPanel's rows,
      // an event's nearby-cities panel) — cache THEM too, not just the camera
      // centre, or those sparks 404 forever. Right after the centre, ahead of the
      // off-air recent-quake pre-cache below.
      const zoom = typeof bs?.camera?.zoom === "number" ? bs.camera.zoom : 0;
      pts.push(...(await framedCityPoints(db, [c[0], c[1]], zoom)));
    }
  } catch {
    /* no broadcast state yet — fall back to quakes only */
  }
  const quakes = await db.quakes.list({ minMag: FOCUS_MIN_MAG, limit: 30 });
  for (const q of quakes) pts.push([q.lng, q.lat]);
  return pts;
}

/**
 * The biggest cities inside the current on-air frame — a superset of what the
 * broadcast panels actually spark (both the framed-bbox TOP CITIES and an
 * event's ±3° nearby-cities selections), so caching these covers every per-city
 * /climate request the frame makes. Top-N by population in a generous box around
 * the centre; empty for wide/global shots (no per-city sparks) and fail-open (a
 * query error just skips this tick's city warm). 0.1° dedup happens upstream.
 */
export async function framedCityPoints(
  db: Awaited<ReturnType<typeof getAppDb>>,
  center: [number, number],
  zoom: number,
): Promise<[number, number][]> {
  if (!(zoom >= SPOTLIGHT_ZOOM)) return [];
  const [lng, lat] = center;
  // Box shrinks with zoom but never below ±3.5° so it always ⊇ the event
  // nearby-cities ±3° box; capped so a mid-zoom shot can't pull a hemisphere.
  const half = Math.max(3.5, Math.min(30, 180 / Math.pow(2, zoom)));
  const s = Math.max(-90, lat - half);
  const n = Math.min(90, lat + half);
  const wrap = (l: number) => ((l + 540) % 360) - 180;
  const w = wrap(lng - half);
  const e = wrap(lng + half);
  const query: Record<string, unknown> = { lat: { $gte: s, $lte: n } };
  if (w <= e) query.lng = { $gte: w, $lte: e };
  else query.$or = [{ lng: { $gte: w } }, { lng: { $lte: e } }]; // antimeridian-safe
  try {
    const res = await db.cities.getAll(query, { sort: { population: -1 }, limit: FRAMED_CITY_LIMIT });
    const rows = (res?.data ?? []) as Array<{ lng: number; lat: number }>;
    return rows
      .filter((c) => typeof c.lng === "number" && typeof c.lat === "number")
      .map((c) => [c.lng, c.lat] as [number, number]);
  } catch {
    return [];
  }
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

// ── All-city climate backfill ──────────────────────────────────────────────
// The focus-driven snapshot above only caches what the LIVE camera frames, so
// the director's PAST YEAR / monthly-climate panel 404s for anywhere the
// broadcast hasn't recently visited. This backfill fetches the past-year ERA5
// climate for EVERY city >= a population floor (deduped to ~5.4k 0.1° keys at
// >=100k), in restartable LOW-priority batches, so the panel has a nearby cached
// point everywhere. Under the collection's 14-day TTL it re-runs weekly to keep
// those docs alive (see worker/src/index.ts).

/** Population floor for a city to get a backfilled climate doc. */
const BACKFILL_POP_FLOOR = Number(process.env.CLIMATE_BACKFILL_POP_FLOOR || 100_000);
/** Keys fetched within this window are skipped — comfortably under the 14-day
 *  cache TTL and the weekly re-run, but long enough that a stopped/failed sweep
 *  resumes (already-done keys aren't re-fetched) rather than restarting. */
const BACKFILL_MAX_AGE_MS = Number(process.env.CLIMATE_BACKFILL_MAX_AGE_MS || 6 * 24 * 60 * 60 * 1000);
/** Keys fetched per chained batch link (bounded so no one job runs for ages). */
const BACKFILL_BATCH = Number(process.env.CLIMATE_BACKFILL_BATCH || 100);
/** Hard cap on chained links — a backstop against a runaway loop. */
const BACKFILL_MAX_BATCHES = Number(process.env.CLIMATE_BACKFILL_MAX_BATCHES || 2000);
/** Politeness pause between Open-Meteo archive fetches (ms). */
const BACKFILL_FETCH_GAP_MS = Number(process.env.CLIMATE_BACKFILL_GAP_MS || 150);

/**
 * Distinct 0.1° climate points for a city list, first-seen order preserved (feed
 * a population-sorted list → biggest cities first). One representative lat/lng
 * per key. Pure + exported for tests.
 */
export function cityClimatePoints(
  cities: { lat: number; lng: number }[],
): { key: string; lat: number; lng: number }[] {
  const seen = new Set<string>();
  const out: { key: string; lat: number; lng: number }[] = [];
  for (const c of cities) {
    if (typeof c.lat !== "number" || typeof c.lng !== "number") continue;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    const key = climateKey(c.lat, c.lng);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, lat: c.lat, lng: c.lng });
  }
  return out;
}

/**
 * One backfill batch: fetch the past year for the next `batchSize` city keys not
 * already fresh (< BACKFILL_MAX_AGE_MS). Queue-agnostic — returns counts so the
 * caller decides whether to continue (the job handler chains via BullMQ; the CLI
 * loops in-process). A fetched key becomes fresh, so the next batch's `stale`
 * set naturally advances — no fragile offsets (mirrors cities.enrichWikiAll).
 */
export async function backfillClimateBatch(
  db: Awaited<ReturnType<typeof getAppDb>>,
  opts: { minPop: number; batchSize: number; gapMs?: number },
): Promise<{ keys: number; stale: number; fetched: number; failed: number; remaining: number }> {
  const cityDocs = (await db.cities.model
    .find({ population: { $gte: opts.minPop } }, { lat: 1, lng: 1, _id: 0 })
    .sort({ population: -1 })
    .lean()
    .exec()) as { lat: number; lng: number }[];
  const points = cityClimatePoints(cityDocs);
  if (!points.length) return { keys: 0, stale: 0, fetched: 0, failed: 0, remaining: 0 };

  const cutoff = new Date(Date.now() - BACKFILL_MAX_AGE_MS);
  const fresh = await db.climateYears.freshKeys(
    points.map((p) => p.key),
    cutoff,
  );
  const stale = points.filter((p) => !fresh.has(p.key));
  const slice = stale.slice(0, opts.batchSize);

  let fetched = 0;
  let failed = 0;
  for (const p of slice) {
    try {
      const year = await fetchClimateYear(p.lat, p.lng);
      if (year) {
        await db.climateYears.upsert(year);
        fetched++;
      }
    } catch (err) {
      failed++;
      log(TAG, `backfill fetch failed for ${p.key}`, summarizeForLog(err));
    }
    if (opts.gapMs) await sleep(opts.gapMs);
  }

  return { keys: points.length, stale: stale.length, fetched, failed, remaining: Math.max(0, stale.length - slice.length) };
}

/**
 * Job handler `climate.backfillClimate`. Runs one bounded batch then, if stale
 * keys remain and this batch made progress, enqueues the next link at LOW
 * priority. A batch that fetched nothing (upstream outage) stops the chain
 * rather than spinning — the weekly schedule / a manual re-run picks it back up.
 */
export async function backfillClimate(job: Job) {
  const d = job.data?.data ?? {};
  const minPop = Number.isFinite(d.minPopulation) ? Number(d.minPopulation) : BACKFILL_POP_FLOOR;
  const batchSize = Math.min(Math.max(Number(d.batchSize) || BACKFILL_BATCH, 10), 500);
  const batch = Math.max(Number(d.batch) || 1, 1);
  const maxBatches = Math.min(Math.max(Number(d.maxBatches) || BACKFILL_MAX_BATCHES, 1), 5000);
  const db = await getAppDb();
  try {
    const r = await backfillClimateBatch(db, { minPop, batchSize, gapMs: BACKFILL_FETCH_GAP_MS });
    if (!r.keys) {
      log(TAG, "backfill: no cities >= floor — seed cities first", { minPop });
      return { ...r, minPop, batch, continued: false };
    }
    const shouldContinue = r.remaining > 0 && r.fetched > 0 && batch < maxBatches;
    if (shouldContinue) {
      await sendToQueue(
        "climate",
        "climate",
        "backfillClimate",
        { minPopulation: minPop, batchSize, batch: batch + 1, maxBatches },
        undefined,
        QUEUE_PRIORITY.LOW,
      );
    }
    const result = { ...r, minPop, batch, continued: shouldContinue };
    log(TAG, "backfill batch done", result);
    // One blog line at the start and one at the end of a sweep — not per batch.
    if (r.fetched > 0 && (batch === 1 || !shouldContinue)) {
      blogInfo(
        TAG,
        `climate backfill: batch ${batch}, ${r.fetched} cached, ${r.remaining} to go`,
        result,
        "climate",
        "backfillClimate",
      );
    }
    return result;
  } catch (err) {
    log(TAG, `backfill batch ${batch} failed`, summarizeForLog(err));
    blogErr(TAG, `climate backfill batch ${batch} failed`, err, "climate", "backfillClimate");
    throw err;
  }
}

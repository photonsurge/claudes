import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchStations, fetchSeries } from "@photonsurge/shared/tides/ioc";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import type { TideSeries } from "@photonsurge/shared/tides/types";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";

const TAG = "job:tides";

/** How near a focus point a gauge must be to be worth caching for it. */
const FOCUS_RADIUS_KM = Number(process.env.TIDE_FOCUS_RADIUS_KM || 600);
/** Cap on gauges cached per snapshot — the gauge only shows the single nearest. */
const MAX_STATIONS = Number(process.env.TIDE_MAX_STATIONS || 8);
/** Recent-series window to cache per station, hours. */
const SERIES_HOURS = Number(process.env.TIDE_SERIES_HOURS || 6);
/** Magnitude floor for quakes that pull a nearby gauge into the cache. */
const FOCUS_MIN_MAG = Number(process.env.TIDE_FOCUS_MIN_MAG || 5.5);

/**
 * Dispatched as type "tides", event "refreshStations". Rebuilds the global IOC
 * sea-level gauge catalog in Mongo. Near-static reference data (runs daily); the
 * snapshot job below reads it to find the gauge nearest what's on air.
 */
export async function refreshStations(_job: Job) {
  const db = await getAppDb();
  try {
    const stations = await fetchStations();
    const r = await db.tideStations.replace(stations);
    const result = { stations: r.stations };
    log(TAG, `tide stations refresh done`, result);
    blogInfo(TAG, `tide stations: ${r.stations} gauges`, result, "tides", "refreshStations");
    return result;
  } catch (err) {
    log(TAG, `tide stations refresh failed`, summarizeForLog(err));
    blogErr(TAG, `tide stations refresh failed`, err, "tides", "refreshStations");
    throw err;
  }
}

/** [lng,lat] focus points = current on-air camera + recent significant quakes. */
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
  // Significant quakes drive the gauge to their coast; tsunami-flagged first.
  const quakes = await db.quakes.list({ minMag: FOCUS_MIN_MAG, limit: 30 });
  quakes.sort((a, b) => Number(b.tsunami) - Number(a.tsunami));
  for (const q of quakes) pts.push([q.lng, q.lat]);
  return pts;
}

/**
 * Dispatched as type "tides", event "snapshotTides". Focus-driven: resolves the
 * gauges nearest what's currently on air (camera + significant quakes), fetches
 * each one's recent water-level series and caches it. Keeps upstream load to a
 * handful of stations per tick and makes the cached data inherently relevant to
 * the broadcast. The public gauge reads only this cache.
 */
export async function snapshotTides(_job: Job) {
  const db = await getAppDb();
  try {
    const points = await focusPoints(db);
    // Nearest station to each focus point, deduped, capped.
    const chosen = new Map<string, { stationId: string; provider: "ioc" | "coops" | "dart"; name: string; lng: number; lat: number; sensor?: string }>();
    for (const [lng, lat] of points) {
      if (chosen.size >= MAX_STATIONS) break;
      const near = await db.tideStations.nearest({ lng, lat, maxKm: FOCUS_RADIUS_KM });
      if (!near) continue;
      chosen.set(`${near.station.provider}:${near.station.stationId}`, near.station);
    }

    let cached = 0;
    for (const s of chosen.values()) {
      try {
        const samples = await fetchSeries(s.stationId, SERIES_HOURS, s.sensor);
        if (!samples.length) continue;
        const series: TideSeries = {
          stationId: s.stationId,
          provider: s.provider,
          name: s.name,
          lng: s.lng,
          lat: s.lat,
          unit: "m",
          samples,
          latest: samples[samples.length - 1].v,
          updatedAt: Date.now(),
        };
        await db.tideSeries.upsert(series);
        cached++;
      } catch (err) {
        log(TAG, `series fetch failed for ${s.stationId}`, summarizeForLog(err));
      }
    }

    const result = { focus: points.length, stations: chosen.size, cached };
    log(TAG, `tide snapshot done`, result);
    blogInfo(TAG, `tide snapshot: ${cached} gauge series cached`, result, "tides", "snapshotTides");
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "tides", count: cached } });
    return result;
  } catch (err) {
    log(TAG, `tide snapshot failed`, summarizeForLog(err));
    blogErr(TAG, `tide snapshot failed`, err, "tides", "snapshotTides");
    throw err;
  }
}

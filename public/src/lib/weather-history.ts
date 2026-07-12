// lib/weather-history.ts
// Server-side helpers for the /api/weather/history routes: decode an archived
// WeatherFrame's PNG back to RGBA (sharp — ~3× faster than pngjs at weather
// grid sizes), pick the best frame per valid time when several models overlap
// a point, and build a sampled time series with stats. Samples are memoised
// per (frame, point) — frames are immutable, and the broadcast panel asks for
// the same focus point across many variables/frames — so repeat views skip the
// decode entirely. Sampling math lives in @photonsurge/shared/weather/sample.

import "./sharp-config"; // caps libvips concurrency/cache BEFORE the first decode
import sharp from "sharp";
import { bufferOf } from "@photonsurge/shared/utill/buffer";
import {
  sampleFrame,
  areaStatsFrame,
  seriesStats,
  type AreaStats,
  type FrameLike,
  type FrameSample,
} from "@photonsurge/shared/weather/sample";
import { pickFramesForPoint } from "@photonsurge/shared/weather/pick";
import type { iWeatherFrameModel } from "@photonsurge/shared/db/weather-frame-model";
import type { WeatherFrameMeta } from "@photonsurge/shared/db/weather-frame-repo";
// Series shapes moved to shared so the worker's panel precompute produces the
// exact same objects; re-exported here so existing `./weather-history` importers
// (and pickFramesForPoint's callers) are unchanged.
export { pickFramesForPoint };
export type {
  HistoryPoint,
  HistorySeries,
  AreaHistoryPoint,
  AreaHistorySeries,
} from "@photonsurge/shared/weather/history-types";
import type {
  HistoryPoint,
  HistorySeries,
  AreaHistoryPoint,
  AreaHistorySeries,
} from "@photonsurge/shared/weather/history-types";

/**
 * A frame LOADER: fetch one archived frame's full bytes by id (db.weatherFrames
 * getByID), or null if gone. Passing this instead of a pre-loaded frames[] is
 * what keeps memory bounded — the builders pull bytes for only the PICKED frames,
 * a few at a time, and let each go before the next (see buildHistorySeries).
 */
export type FrameLoader = (id: string) => Promise<iWeatherFrameModel | null>;

/** How many frames' bytes to hold in RAM at once while sampling a series. The
 *  killer was loading EVERY frame's PNG up front (all vars × 72h → GBs → public
 *  OOM); streaming this few at a time caps peak at ~this many decoded frames. */
const STREAM_BATCH = Math.max(1, Number(process.env.HISTORY_STREAM_BATCH || 6));

/** Decode an archived frame doc into a sampleable grid. */
export async function frameToSampleable(frame: iWeatherFrameModel): Promise<FrameLike> {
  const { data, info } = await sharp(bufferOf(frame.data))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
    bounds: frame.bounds,
    res: frame.grid.res,
    encoding: frame.encoding,
    imageUnscale: frame.imageUnscale,
    vectorUnscale: frame.vectorUnscale,
  };
}

// ── Per-(frame, point) sample memo ─────────────────────────────────────────
// Frames are immutable once archived, so entries never go stale; the map is
// simply capped (FIFO) so a long-running server can't grow without bound.
// ~50k entries ≈ a few MB; each saves a 10-40ms full-frame decode.
const SAMPLE_CACHE_MAX = 50_000;
const sampleCache = new Map<string, FrameSample | null>();

function cacheKey(frameId: string, lat: number, lng: number): string {
  return `${frameId}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
}

/**
 * Sample one frame at lat/lng through the memo; loads + decodes the bytes at
 * most once. On a memo MISS it calls `loadFrame(id)` — so a frame's PNG is
 * fetched only when actually sampled, and is released once its scalar sample is
 * memoised (the memo holds tiny FrameSample values, never the bytes).
 */
async function sampleByIdCached(
  id: string,
  lat: number,
  lng: number,
  getFrame: () => Promise<iWeatherFrameModel | null>,
): Promise<FrameSample | null> {
  const key = cacheKey(id, lat, lng);
  const hit = sampleCache.get(key);
  if (hit !== undefined) return hit;

  let sample: FrameSample | null = null;
  const frame = await getFrame(); // bytes fetched HERE, freed after decode
  if (frame) {
    try {
      sample = sampleFrame(await frameToSampleable(frame), lat, lng);
    } catch {
      sample = null; // undecodable frame reads as nodata
    }
  }

  if (sampleCache.size >= SAMPLE_CACHE_MAX) {
    // FIFO prune: drop the oldest tenth so pruning is rare, not per-insert.
    let drop = SAMPLE_CACHE_MAX / 10;
    for (const k of sampleCache.keys()) {
      sampleCache.delete(k);
      if (--drop <= 0) break;
    }
  }
  sampleCache.set(key, sample);
  return sample;
}

/** Sample a full frame already in hand through the memo — for callers that load
 *  their (fewer) frames up front, e.g. the forecast builder. */
export async function sampleFrameCached(
  frame: iWeatherFrameModel,
  lat: number,
  lng: number,
): Promise<FrameSample | null> {
  return sampleByIdCached(frame.id, lat, lng, async () => frame);
}

/** Sample a frame identified by metadata; its bytes are loaded via `loadFrame`
 *  ONLY on a memo miss — the streaming path that keeps history memory bounded. */
async function sampleMetaCached(
  meta: WeatherFrameMeta,
  lat: number,
  lng: number,
  loadFrame: FrameLoader,
): Promise<FrameSample | null> {
  return sampleByIdCached(meta.id, lat, lng, () => loadFrame(meta.id));
}

/**
 * Sample `picked` frames in STREAM_BATCH-sized waves. Each wave loads + decodes
 * at most STREAM_BATCH frames concurrently; those bytes are unreferenced (→ GC)
 * before the next wave. This is the memory fix — peak RAM is a handful of frames,
 * not the whole series. Returns results in `picked` order.
 */
async function streamSamples<T>(
  picked: WeatherFrameMeta[],
  sampleOne: (meta: WeatherFrameMeta) => Promise<T>,
): Promise<T[]> {
  const out = new Array<T>(picked.length);
  for (let i = 0; i < picked.length; i += STREAM_BATCH) {
    const wave = await Promise.all(picked.slice(i, i + STREAM_BATCH).map((m) => sampleOne(m)));
    for (let j = 0; j < wave.length; j++) out[i + j] = wave[j];
  }
  return out;
}

/** Sample every frame at lat/lng and assemble the series + stats payload.
 *  Takes frame METADATA + a loader; picked frames' bytes are streamed in (a few
 *  at a time) and freed — never the whole series in RAM at once. */
export async function buildHistorySeries(
  variable: string,
  meta: WeatherFrameMeta[],
  lat: number,
  lng: number,
  loadFrame: FrameLoader,
): Promise<HistorySeries> {
  const picked = pickFramesForPoint(meta, lat, lng);
  const samples = await streamSamples(picked, (m) => sampleMetaCached(m, lat, lng, loadFrame));
  const series: HistoryPoint[] = [];
  const statValues: number[] = [];
  let encoding: "scalar" | "uv" = "scalar";
  let units = "";

  picked.forEach((frame, i) => {
    encoding = frame.encoding;
    units = frame.units || units;
    const sample = samples[i];
    if (!sample) return;
    const point: HistoryPoint = {
      t: new Date(frame.validTime).toISOString(),
      model: frame.model,
      fhr: frame.fhr,
    };
    if (sample.kind === "scalar") {
      point.value = sample.value;
      statValues.push(sample.value);
    } else {
      point.u = sample.u;
      point.v = sample.v;
      point.speed = sample.speed;
      statValues.push(sample.speed);
    }
    series.push(point);
  });

  return { variable, encoding, units, lat, lng, series, stats: seriesStats(statValues) };
}

// ── Area history ────────────────────────────────────────────────────────────

const areaCache = new Map<string, AreaStats | null>();

function areaCacheKey(frameId: string, bbox: [number, number, number, number]): string {
  return `${frameId}|${bbox.map((v) => v.toFixed(1)).join(",")}`;
}

/** Spatially aggregate one frame over bbox through the memo (frames immutable).
 *  Loads the bytes via `loadFrame` only on a memo miss, then frees them. */
async function areaStatsMetaCached(
  meta: WeatherFrameMeta,
  bbox: [number, number, number, number],
  loadFrame: FrameLoader,
): Promise<AreaStats | null> {
  const key = areaCacheKey(meta.id, bbox);
  const hit = areaCache.get(key);
  if (hit !== undefined) return hit;
  let stats: AreaStats | null = null;
  const frame = await loadFrame(meta.id);
  if (frame) {
    try {
      stats = areaStatsFrame(await frameToSampleable(frame), bbox);
    } catch {
      stats = null;
    }
  }
  if (areaCache.size >= SAMPLE_CACHE_MAX) areaCache.clear();
  areaCache.set(key, stats);
  return stats;
}

/**
 * Build the area time series: per valid time, the finest frame overlapping the
 * bbox is aggregated to mean/min/max over the covered pixels. Frame selection
 * uses the bbox centre (same finest-covering rule as point series).
 */
export async function buildAreaHistorySeries(
  variable: string,
  meta: WeatherFrameMeta[],
  bbox: [number, number, number, number],
  loadFrame: FrameLoader,
): Promise<AreaHistorySeries> {
  const centerLat = (bbox[1] + bbox[3]) / 2;
  let centerLng = (bbox[0] + bbox[2]) / 2;
  if (bbox[2] < bbox[0]) centerLng = ((bbox[0] + bbox[2] + 360) / 2 + 180) % 360 - 180; // seam-crossing window
  const picked = pickFramesForPoint(meta, centerLat, centerLng);
  const statsPerFrame = await streamSamples(picked, (m) => areaStatsMetaCached(m, bbox, loadFrame));

  const series: AreaHistoryPoint[] = [];
  const means: number[] = [];
  let encoding: "scalar" | "uv" = "scalar";
  let units = "";
  let areaMin: number | null = null;
  let areaMax: number | null = null;

  picked.forEach((frame, i) => {
    encoding = frame.encoding;
    units = frame.units || units;
    const stats = statsPerFrame[i];
    if (!stats) return;
    series.push({
      t: new Date(frame.validTime).toISOString(),
      model: frame.model,
      fhr: frame.fhr,
      mean: stats.mean,
      min: stats.min,
      max: stats.max,
    });
    means.push(stats.mean);
    areaMin = areaMin == null ? stats.min : Math.min(areaMin, stats.min);
    areaMax = areaMax == null ? stats.max : Math.max(areaMax, stats.max);
  });

  return { variable, encoding, units, bbox, series, stats: seriesStats(means), areaMin, areaMax };
}

/** Parse a from/to query param (ISO string or epoch ms); undefined when absent/bad. */
export function parseTimeParam(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const asNum = Number(raw);
  const d = Number.isFinite(asNum) && raw.trim() !== "" ? new Date(asNum) : new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

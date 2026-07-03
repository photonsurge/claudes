// lib/weather-history.ts
// Server-side helpers for the /api/weather/history routes: decode an archived
// WeatherFrame's PNG back to RGBA (sharp — ~3× faster than pngjs at weather
// grid sizes), pick the best frame per valid time when several models overlap
// a point, and build a sampled time series with stats. Samples are memoised
// per (frame, point) — frames are immutable, and the broadcast panel asks for
// the same focus point across many variables/frames — so repeat views skip the
// decode entirely. Sampling math lives in @photonsurge/shared/weather/sample.

import sharp from "sharp";
import { bufferOf } from "@photonsurge/shared/utill/buffer";
import {
  sampleFrame,
  areaStatsFrame,
  seriesStats,
  latLngToPixel,
  type AreaStats,
  type FrameLike,
  type FrameSample,
  type SeriesStats,
} from "@photonsurge/shared/weather/sample";
import type { iWeatherFrameModel } from "@photonsurge/shared/db/weather-frame-model";

/** One sampled moment; scalar frames fill `value`, uv frames fill u/v/speed. */
export interface HistoryPoint {
  /** ISO valid time. */
  t: string;
  model: string;
  fhr: number;
  value?: number;
  u?: number;
  v?: number;
  speed?: number;
}

export interface HistorySeries {
  variable: string;
  encoding: "scalar" | "uv";
  units: string;
  lat: number;
  lng: number;
  series: HistoryPoint[];
  /** Over `value` for scalars, `speed` for vectors. Null when nothing sampled. */
  stats: SeriesStats | null;
}

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

/** Sample one frame at lat/lng through the memo; decodes at most once. */
export async function sampleFrameCached(
  frame: iWeatherFrameModel,
  lat: number,
  lng: number,
): Promise<FrameSample | null> {
  const key = cacheKey(frame.id, lat, lng);
  const hit = sampleCache.get(key);
  if (hit !== undefined) return hit;

  let sample: FrameSample | null = null;
  try {
    sample = sampleFrame(await frameToSampleable(frame), lat, lng);
  } catch {
    sample = null; // undecodable frame reads as nodata
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

/**
 * When several models archived the same variable+validTime (global run vs a
 * regional nest), keep — per valid time — only the finest-resolution frame
 * that actually covers the point. Frames not covering the point drop out.
 */
export function pickFramesForPoint(
  frames: iWeatherFrameModel[],
  lat: number,
  lng: number,
): iWeatherFrameModel[] {
  const byTime = new Map<string, iWeatherFrameModel>();
  for (const f of frames) {
    if (!latLngToPixel(lat, lng, { bounds: f.bounds, res: f.grid.res, width: f.grid.width, height: f.grid.height })) {
      continue;
    }
    const key = new Date(f.validTime).toISOString();
    const kept = byTime.get(key);
    if (!kept || f.grid.res < kept.grid.res) byTime.set(key, f);
  }
  return [...byTime.values()].sort(
    (a, b) => new Date(a.validTime).getTime() - new Date(b.validTime).getTime(),
  );
}

/** Sample every frame at lat/lng and assemble the series + stats payload. */
export async function buildHistorySeries(
  variable: string,
  frames: iWeatherFrameModel[],
  lat: number,
  lng: number,
): Promise<HistorySeries> {
  const picked = pickFramesForPoint(frames, lat, lng);
  const series: HistoryPoint[] = [];
  const statValues: number[] = [];
  let encoding: "scalar" | "uv" = "scalar";
  let units = "";

  for (const frame of picked) {
    encoding = frame.encoding;
    units = frame.units || units;
    const sample = await sampleFrameCached(frame, lat, lng);
    if (!sample) continue;
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
  }

  return { variable, encoding, units, lat, lng, series, stats: seriesStats(statValues) };
}

// ── Area history ────────────────────────────────────────────────────────────

/** One frame's spatial aggregate over the requested window. */
export interface AreaHistoryPoint {
  /** ISO valid time. */
  t: string;
  model: string;
  fhr: number;
  mean: number;
  min: number;
  max: number;
}

export interface AreaHistorySeries {
  variable: string;
  encoding: "scalar" | "uv";
  units: string;
  bbox: [number, number, number, number];
  series: AreaHistoryPoint[];
  /** Temporal stats over the per-frame AREA MEANS. */
  stats: SeriesStats | null;
  /** Spatial extremes across the whole window (min of mins / max of maxes). */
  areaMin: number | null;
  areaMax: number | null;
}

const areaCache = new Map<string, AreaStats | null>();

function areaCacheKey(frameId: string, bbox: [number, number, number, number]): string {
  return `${frameId}|${bbox.map((v) => v.toFixed(1)).join(",")}`;
}

/** Spatially aggregate one frame over bbox through the memo (frames immutable). */
async function areaStatsCached(
  frame: iWeatherFrameModel,
  bbox: [number, number, number, number],
): Promise<AreaStats | null> {
  const key = areaCacheKey(frame.id, bbox);
  const hit = areaCache.get(key);
  if (hit !== undefined) return hit;
  let stats: AreaStats | null = null;
  try {
    stats = areaStatsFrame(await frameToSampleable(frame), bbox);
  } catch {
    stats = null;
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
  frames: iWeatherFrameModel[],
  bbox: [number, number, number, number],
): Promise<AreaHistorySeries> {
  const centerLat = (bbox[1] + bbox[3]) / 2;
  let centerLng = (bbox[0] + bbox[2]) / 2;
  if (bbox[2] < bbox[0]) centerLng = ((bbox[0] + bbox[2] + 360) / 2 + 180) % 360 - 180; // seam-crossing window
  const picked = pickFramesForPoint(frames, centerLat, centerLng);

  const series: AreaHistoryPoint[] = [];
  const means: number[] = [];
  let encoding: "scalar" | "uv" = "scalar";
  let units = "";
  let areaMin: number | null = null;
  let areaMax: number | null = null;

  for (const frame of picked) {
    encoding = frame.encoding;
    units = frame.units || units;
    const stats = await areaStatsCached(frame, bbox);
    if (!stats) continue;
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
  }

  return { variable, encoding, units, bbox, series, stats: seriesStats(means), areaMin, areaMax };
}

/** Parse a from/to query param (ISO string or epoch ms); undefined when absent/bad. */
export function parseTimeParam(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const asNum = Number(raw);
  const d = Number.isFinite(asNum) && raw.trim() !== "" ? new Date(asNum) : new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

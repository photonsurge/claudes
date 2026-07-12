// weather/sampleService.ts
// The worker's on-demand frame-sampling service — the counterpart to public's
// (soon-removed) buildHistorySeries/buildAreaHistorySeries. The worker is the
// SOLE decoder now: it reads archived frame bytes from the shared ${BLOB_DIR}
// blob store (no Mongo pressure), sharp-decodes them (frameDecode.ts), samples
// with the pure shared helpers, and returns small numeric series. `public` calls
// these over internal HTTP instead of decoding PNGs itself, so the user-facing
// Next server carries no libvips native dep and no decode fan-out.
//
// Output shapes are byte-identical to public's old builders (same shared
// history-types) so nothing downstream (charts, focus bundle) changes.
import type { getAppDb } from "@photonsurge/shared/db/index";
import {
  sampleFrame,
  areaStatsFrame,
  seriesStats,
  type FrameSample,
  type AreaStats,
} from "@photonsurge/shared/weather/sample";
import { pickFramesForPoint } from "@photonsurge/shared/weather/pick";
import type {
  HistoryPoint,
  HistorySeries,
  AreaHistoryPoint,
  AreaHistorySeries,
} from "@photonsurge/shared/weather/history-types";
import type { WeatherFrameMeta } from "@photonsurge/shared/db/weather-frame-repo";
import { decodeFrame, type DecodableFrame } from "./frameDecode";

type Db = Awaited<ReturnType<typeof getAppDb>>;

/** Hold at most this many decoded frames in flight while sampling a series. */
const STREAM_BATCH = Math.max(1, Number(process.env.HISTORY_STREAM_BATCH || 6));

/** Per-(frame, point/bbox) memo — frames are immutable so entries never stale;
 *  capped so a long-running worker can't grow without bound. */
const SAMPLE_CACHE_MAX = 50_000;
const pointMemo = new Map<string, FrameSample | null>();
const areaMemo = new Map<string, AreaStats | null>();

function capped<T>(memo: Map<string, T>): void {
  if (memo.size < SAMPLE_CACHE_MAX) return;
  let drop = SAMPLE_CACHE_MAX / 10;
  for (const k of memo.keys()) {
    memo.delete(k);
    if (--drop <= 0) break;
  }
}

/** Load + decode one frame by id (bytes come from the blob store), or null. */
async function loadGrid(db: Db, id: string) {
  const frame = await db.weatherFrames.getByID(id);
  if (!frame) return null;
  try {
    return await decodeFrame(frame as unknown as DecodableFrame);
  } catch {
    return null; // undecodable frame reads as nodata
  }
}

async function pointSample(db: Db, id: string, lat: number, lng: number): Promise<FrameSample | null> {
  const key = `${id}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const hit = pointMemo.get(key);
  if (hit !== undefined) return hit;
  const grid = await loadGrid(db, id);
  const sample = grid ? sampleFrame(grid, lat, lng) : null;
  capped(pointMemo);
  pointMemo.set(key, sample);
  return sample;
}

async function areaSample(
  db: Db,
  id: string,
  bbox: [number, number, number, number],
): Promise<AreaStats | null> {
  const key = `${id}|${bbox.map((v) => v.toFixed(1)).join(",")}`;
  const hit = areaMemo.get(key);
  if (hit !== undefined) return hit;
  const grid = await loadGrid(db, id);
  const stats = grid ? areaStatsFrame(grid, bbox) : null;
  capped(areaMemo);
  areaMemo.set(key, stats);
  return stats;
}

/** Sample `picked` in STREAM_BATCH waves, releasing each wave's bytes before the
 *  next — peak RAM is a handful of decoded frames, not the whole series. */
async function streamSamples<T>(
  picked: WeatherFrameMeta[],
  one: (m: WeatherFrameMeta) => Promise<T>,
): Promise<T[]> {
  const out = new Array<T>(picked.length);
  for (let i = 0; i < picked.length; i += STREAM_BATCH) {
    const wave = await Promise.all(picked.slice(i, i + STREAM_BATCH).map(one));
    for (let j = 0; j < wave.length; j++) out[i + j] = wave[j];
  }
  return out;
}

export interface PointHistoryArgs {
  variable: string;
  lat: number;
  lng: number;
  from?: Date;
  to?: Date;
  model?: string;
}

/** Point history series + stats — mirrors public's old buildHistorySeries. */
export async function samplePointHistory(db: Db, a: PointHistoryArgs): Promise<HistorySeries> {
  const meta = await db.weatherFrames.listMeta({
    variable: a.variable,
    model: a.model,
    from: a.from,
    to: a.to,
  });
  const picked = pickFramesForPoint(meta, a.lat, a.lng);
  const samples = await streamSamples(picked, (m) => pointSample(db, m.id, a.lat, a.lng));

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
  return { variable: a.variable, encoding, units, lat: a.lat, lng: a.lng, series, stats: seriesStats(statValues) };
}

export interface AreaHistoryArgs {
  variable: string;
  bbox: [number, number, number, number];
  from?: Date;
  to?: Date;
  model?: string;
}

/** Area history series (mean/min/max per step) — mirrors buildAreaHistorySeries. */
export async function sampleAreaHistory(db: Db, a: AreaHistoryArgs): Promise<AreaHistorySeries> {
  const bbox = a.bbox;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  let centerLng = (bbox[0] + bbox[2]) / 2;
  if (bbox[2] < bbox[0]) centerLng = ((bbox[0] + bbox[2] + 360) / 2 + 180) % 360 - 180;
  const meta = await db.weatherFrames.listMeta({
    variable: a.variable,
    model: a.model,
    from: a.from,
    to: a.to,
  });
  const picked = pickFramesForPoint(meta, centerLat, centerLng);
  const statsPerFrame = await streamSamples(picked, (m) => areaSample(db, m.id, bbox));

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
  return { variable: a.variable, encoding, units, bbox, series, stats: seriesStats(means), areaMin, areaMax };
}

// ── Forecast sampling ────────────────────────────────────────────────────────
// The rolling WeatherForecastFrame store, sampled at a point/area per variable.
// Returns the RAW sampled series (t as ISO string over the wire); public's pure
// day-card composition (buildForecastDays/Steps/AreaDays) consumes it — no decode
// in public. Horizon-bounded so the far-future tail isn't decoded needlessly.

const now = () => Date.now();

/** Load + decode one forecast frame by id, or null. */
async function loadForecastGrid(db: Db, id: string) {
  const frame = await db.weatherForecastFrames.getByID(id);
  if (!frame) return null;
  try {
    return await decodeFrame(frame as unknown as DecodableFrame);
  } catch {
    return null;
  }
}

export interface ForecastPointArgs {
  lat: number;
  lng: number;
  variables: string[];
  model?: string;
  maxHours?: number;
}

export interface ForecastPointSeries {
  units: Record<string, string>;
  samplesByVariable: Record<string, { t: string; value: number }[]>;
}

export async function sampleForecastPoint(db: Db, a: ForecastPointArgs): Promise<ForecastPointSeries> {
  const units: Record<string, string> = {};
  const samplesByVariable: Record<string, { t: string; value: number }[]> = {};
  const horizonMs = a.maxHours != null ? now() + a.maxHours * 3600 * 1000 : Infinity;

  for (const variable of a.variables) {
    const meta = await db.weatherForecastFrames.listMeta({ variable, model: a.model });
    const picked = pickFramesForPoint(meta, a.lat, a.lng).filter(
      (m) => new Date(m.validTime).getTime() <= horizonMs,
    );
    const samples = await streamSamples(picked, async (m) => {
      units[variable] = m.units || units[variable] || "";
      const grid = await loadForecastGrid(db, m.id);
      const s = grid ? sampleFrame(grid, a.lat, a.lng) : null;
      if (!s) return null;
      return { t: new Date(m.validTime).toISOString(), value: s.kind === "scalar" ? s.value : s.speed };
    });
    samplesByVariable[variable] = samples.filter((x): x is { t: string; value: number } => x !== null);
  }
  return { units, samplesByVariable };
}

export interface ForecastAreaArgs {
  bbox: [number, number, number, number];
  variables: string[];
  model?: string;
  maxHours?: number;
}

export interface ForecastAreaSeries {
  units: Record<string, string>;
  samplesByVariable: Record<string, { t: string; stats: AreaStats }[]>;
}

export async function sampleForecastArea(db: Db, a: ForecastAreaArgs): Promise<ForecastAreaSeries> {
  const bbox = a.bbox;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  let centerLng = (bbox[0] + bbox[2]) / 2;
  if (bbox[2] < bbox[0]) centerLng = ((bbox[0] + bbox[2] + 360) / 2 + 180) % 360 - 180;
  const units: Record<string, string> = {};
  const samplesByVariable: Record<string, { t: string; stats: AreaStats }[]> = {};
  const horizonMs = a.maxHours != null ? now() + a.maxHours * 3600 * 1000 : Infinity;

  for (const variable of a.variables) {
    const meta = await db.weatherForecastFrames.listMeta({ variable, model: a.model });
    const picked = pickFramesForPoint(meta, centerLat, centerLng).filter(
      (m) => new Date(m.validTime).getTime() <= horizonMs,
    );
    const rows = await streamSamples(picked, async (m) => {
      units[variable] = m.units || units[variable] || "";
      const grid = await loadForecastGrid(db, m.id);
      const stats = grid ? areaStatsFrame(grid, bbox) : null;
      if (!stats) return null;
      return { t: new Date(m.validTime).toISOString(), stats };
    });
    samplesByVariable[variable] = rows.filter(
      (x): x is { t: string; stats: AreaStats } => x !== null,
    );
  }
  return { units, samplesByVariable };
}

// weather/history-types.ts
// The sampled-series shapes the on-air history panels render. Moved here (from
// public/lib/weather-history) so the worker's panel precompute can produce the
// EXACT same objects the public builders do — the precomputed panel drops
// straight into a FocusBundle's pointHistory/areaHistory with no adapter.
import type { SeriesStats } from "./sample";

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

// lib/weather-forecast.ts
// Server-side helpers for the /api/weather/forecast routes: turn raw 3-hourly
// WeatherForecastFrame steps into the daily hi/lo cards the broadcast strip
// shows (Today/Tomorrow/+2/+3), plus a derived hazard flag per day. Reuses the
// history feature's decode/sample/pick helpers directly (frames are the same
// shape) — no duplicated PNG-decode logic.

import {
  classifyForecastDay,
  type DayAggregate,
  type ForecastHazardFlag,
} from "@photonsurge/shared/weather/forecastHazard";
// The worker decodes + samples the forecast store; this file only COMPOSES the
// day cards from those pre-sampled numbers (no sharp/PNG decode in public).
import type { ForecastPointSeries, ForecastAreaSeries } from "./worker-sample";

export type ForecastDayLabel = "TODAY" | "TOMORROW" | `+${number}`;
export type ForecastCondition = "sunny" | "partly-cloudy" | "cloudy" | "rain" | "snow" | "storm";

/** A day-bucket key: which calendar day (at the point's local-hour offset) and its card label. */
export interface ForecastDayKey {
  key: string;
  label: ForecastDayLabel;
  date: string;
}

/** Detailed 3-day card strip; the extended daily outlook passes a larger count. */
export const DEFAULT_FORECAST_DAYS = 4;
/** Longest daily outlook the 12-hourly store can back (GFS 384h ≈ 16 days). */
export const MAX_FORECAST_DAYS = 16;

/** Day-card labels: TODAY, TOMORROW, then +2, +3 … up to `count` days. */
export function dayLabels(count: number): ForecastDayLabel[] {
  const n = Math.max(1, Math.min(MAX_FORECAST_DAYS, Math.floor(count)));
  const out: ForecastDayLabel[] = ["TODAY", "TOMORROW"];
  for (let i = 2; i < n; i++) out.push(`+${i}`);
  return out.slice(0, n);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Human-friendly day label for a local date key ("YYYY-MM-DD"): "Today",
 * "Tomorrow", then the weekday name ("Wednesday"…) — never "+2"/"+3". `lng`
 * gives the same longitude-only local-day offset the buckets use, so "today"
 * is the point's local today. Weekday is read via UTC accessors on the key so
 * it is machine-timezone independent.
 */
export function humanDayLabel(dateKey: string, lng: number): string {
  const todayMs = Date.parse(localDateKey(new Date(), localDayOffsetHours(lng)));
  const idx = Math.round((Date.parse(dateKey) - todayMs) / 86_400_000);
  if (idx <= 0) return "Today";
  if (idx === 1) return "Tomorrow";
  return WEEKDAYS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];
}

/**
 * Longitude-only "local day" heuristic — not a real timezone lookup (none
 * exists in this repo), just an hour offset from longitude so a step landing
 * at 9pm UTC in Tokyo files under the right calendar day for that point.
 */
export function localDayOffsetHours(lng: number): number {
  return Math.round(lng / 15);
}

function localDateKey(date: Date, offsetHours: number): string {
  return new Date(date.getTime() + offsetHours * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Bucket every step's validTime into up to `maxDays` calendar days (today +
 * next maxDays-1) from "now" at this point's approximate local offset. Steps
 * outside that window are dropped. Defaults to the detailed 4-day strip; the
 * extended daily outlook passes a larger count.
 */
export function bucketForecastDays(
  validTimes: Date[],
  lng: number,
  maxDays: number = DEFAULT_FORECAST_DAYS,
): ForecastDayKey[] {
  const labels = dayLabels(maxDays);
  const offset = localDayOffsetHours(lng);
  const todayMs = Date.parse(localDateKey(new Date(), offset));
  const byKey = new Map<string, number>();
  for (const t of validTimes) {
    const key = localDateKey(t, offset);
    const idx = Math.round((Date.parse(key) - todayMs) / 86_400_000);
    if (idx >= 0 && idx < labels.length && !byKey.has(key)) byKey.set(key, idx);
  }
  return [...byKey.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([date, idx]) => ({ key: date, label: labels[idx], date }));
}

/**
 * "Precip chance" proxy: % of a day's 3-hourly steps whose sampled rain rate
 * exceeds a floor, rounded to the nearest 10. Deterministic GFS has no
 * ensemble/POP field — this is an explicit approximation, not a true
 * probability of precipitation.
 */
const PRECIP_FLOOR_MMH = 0.1;
export function precipChanceFromSteps(rainRates: number[]): number {
  if (rainRates.length === 0) return 0;
  const hits = rainRates.filter((r) => r >= PRECIP_FLOOR_MMH).length;
  return Math.round(((hits / rainRates.length) * 100) / 10) * 10;
}

/**
 * Condition icon from a day's aggregated variables: storm (a thunderstorm
 * hazard fired) beats snow (measurable precip at/below freezing) beats rain
 * (precip over the floor) beats cloudy/partly-cloudy by cloud cover, else
 * sunny. `fog` has no rule here — no visibility/dewpoint field is baked by
 * this ingest, so it's a documented gap rather than a guess.
 */
export function deriveCondition(day: {
  tempMin: number;
  rainMax: number;
  cloudAvg: number;
  hazards: ForecastHazardFlag[];
}): ForecastCondition {
  if (day.hazards.some((h) => h.hazard === "thunderstorm")) return "storm";
  const hasPrecip = day.rainMax >= PRECIP_FLOOR_MMH;
  if (hasPrecip && day.tempMin <= 0) return "snow";
  if (hasPrecip) return "rain";
  if (day.cloudAvg >= 70) return "cloudy";
  if (day.cloudAvg >= 30) return "partly-cloudy";
  return "sunny";
}

// ── Point forecast ──────────────────────────────────────────────────────────

export interface ForecastDay {
  date: string;
  label: ForecastDayLabel;
  hiTemp: number | null;
  loTemp: number | null;
  windAvg: number | null;
  /** The day's PEAK sustained wind — what a forecast card should lead with;
   *  a daily MEAN of a light-and-variable day reads as nothing happening. */
  windMax: number | null;
  gustMax: number | null;
  /** Meteorological direction the wind blows FROM (0 = north, 90 = east), from
   *  the day's vector-mean u/v. Null when the sampler sent no components (an
   *  older worker) or the day's flow cancels out. */
  windDir: number | null;
  precipChance: number | null;
  cloudAvg: number | null;
  condition: ForecastCondition;
  hazards: ForecastHazardFlag[];
}

/** Compass point the wind blows FROM, for a u (eastward) / v (northward) pair.
 *  Null for a dead calm, where direction is meaningless rather than north. */
export function windDirection(u: number, v: number): number | null {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  if (Math.hypot(u, v) < 1e-6) return null;
  return (270 - (Math.atan2(v, u) * 180) / Math.PI + 360) % 360;
}

/** The 16-point compass label for a "blows from" bearing — "NW", "SSE"… */
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export function compassPoint(deg: number | null): string | null {
  if (deg == null || !Number.isFinite(deg)) return null;
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export interface ForecastSeries {
  lat: number;
  lng: number;
  units: Record<string, string>;
  days: ForecastDay[];
}

/** Longest sampling horizon (hours) the daily cards need for `maxDays`, with a
 *  +1 day of slack so the final day isn't clipped by the local-hour offset. The
 *  caller passes this to the worker so it only decodes the shown days. */
export const forecastHorizonHours = (maxDays: number): number => (maxDays + 1) * 24;

/** Mean/min/max of a value array; null when empty. */
function stats(values: number[]): { mean: number; min: number; max: number } | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { mean: sum / values.length, min, max };
}

/**
 * Build daily hi/lo card data for a point. Defaults to the detailed 3-day strip
 * (today + next 3); pass a larger `maxDays` for the extended daily outlook that
 * the 12-hourly store now backs (up to ~16 days). Sampling is bounded to that
 * horizon so only the shown days are decoded.
 */
export async function buildForecastDays(
  series: ForecastPointSeries,
  lat: number,
  lng: number,
  maxDays: number = DEFAULT_FORECAST_DAYS,
): Promise<ForecastSeries> {
  // Pre-sampled by the worker (bounded to forecastHorizonHours(maxDays) at fetch).
  const { units, samplesByVariable, allValidTimes } = series;

  const offset = localDayOffsetHours(lng);
  const dayKeys = bucketForecastDays(allValidTimes, lng, maxDays);

  const days: ForecastDay[] = dayKeys.map(({ date, label }) => {
    const forDay = (variable: string) =>
      (samplesByVariable[variable] ?? [])
        .filter((s) => localDateKey(s.t, offset) === date)
        .map((s) => s.value);

    const dayAggregates: DayAggregate[] = [];
    const collect = (variable: string) => {
      const values = forDay(variable);
      const s = stats(values);
      if (s) dayAggregates.push({ variable, min: s.min, max: s.max });
      return s;
    };

    const temp = collect("temp");
    const wind = collect("wind");
    const gust = collect("gust");
    const rain = collect("rain");
    const cloud = collect("cloud");
    collect("storm"); // hazard-only, not surfaced on the card

    const hazards = classifyForecastDay(dayAggregates);

    // Direction from the day's VECTOR mean (sum u, sum v) — averaging bearings
    // would put a day that blew due east then due west at "north".
    const windVectors = (samplesByVariable.wind ?? []).filter(
      (s) => localDateKey(s.t, offset) === date && s.u != null && s.v != null,
    );
    const windDir = windVectors.length
      ? windDirection(
          windVectors.reduce((acc, s) => acc + (s.u as number), 0) / windVectors.length,
          windVectors.reduce((acc, s) => acc + (s.v as number), 0) / windVectors.length,
        )
      : null;

    return {
      date,
      label,
      hiTemp: temp?.max ?? null,
      loTemp: temp?.min ?? null,
      windAvg: wind?.mean ?? null,
      windMax: wind?.max ?? null,
      windDir,
      gustMax: gust?.max ?? null,
      precipChance: rain ? precipChanceFromSteps(forDay("rain")) : null,
      cloudAvg: cloud?.mean ?? null,
      condition: deriveCondition({
        tempMin: temp?.min ?? 20,
        rainMax: rain?.max ?? 0,
        cloudAvg: cloud?.mean ?? 0,
        hazards,
      }),
      hazards,
    };
  });

  return { lat, lng, units, days };
}

// ── Point timeline (3-hourly steps) ──────────────────────────────────────────

/**
 * One forecast step in the high-resolution timeline: a single validTime with
 * every sampled variable, a per-step condition/hazard, and pre-computed
 * human-readable local day/hour labels so the renderer (city page, director
 * mode) stays presentational. `dayKey` groups steps into day columns; a step's
 * hazards use the instantaneous value as both min and max.
 */
export interface ForecastStep {
  /** validTime in UTC ISO. */
  t: string;
  /** Local calendar day ("YYYY-MM-DD") for grouping steps into day columns. */
  dayKey: string;
  /** "Today" | "Tomorrow" | weekday name. */
  dayLabel: string;
  /** Local-ish "HH:MM" (longitude offset, not a true timezone). */
  hourLabel: string;
  temp: number | null;
  wind: number | null;
  /** Direction the wind blows FROM at this step (see ForecastDay.windDir). */
  windDir: number | null;
  gust: number | null;
  rain: number | null;
  cloud: number | null;
  storm: number | null;
  condition: ForecastCondition;
  hazards: ForecastHazardFlag[];
}

export interface ForecastStepSeries {
  lat: number;
  lng: number;
  units: Record<string, string>;
  steps: ForecastStep[];
}

/**
 * Build the full 3-hourly timeline (the store holds today..+72h) for a point:
 * the same point samples as the daily cards, but kept per-step instead of
 * collapsed to daily min/max. Steps are the sorted union of every variable's
 * validTimes, each carrying its sampled values and a per-step condition/hazard.
 */
export async function buildForecastSteps(
  series: ForecastPointSeries,
  lat: number,
  lng: number,
): Promise<ForecastStepSeries> {
  // Timeline stays the detailed 3-hourly track only (today..+72h); the caller
  // fetches with maxHours=72 so the 12-hourly outlook tail isn't included.
  const { units, samplesByVariable } = series;
  const offset = localDayOffsetHours(lng);

  // Union every variable's samples by validTime into one row per step. Wind's
  // u/v ride alongside (not in the scalar row) so the step keeps its direction.
  const byTime = new Map<number, Record<string, number>>();
  const windUv = new Map<number, { u: number; v: number }>();
  for (const [variable, samples] of Object.entries(samplesByVariable)) {
    for (const s of samples) {
      const ms = s.t.getTime();
      const row = byTime.get(ms) ?? {};
      row[variable] = s.value;
      byTime.set(ms, row);
      if (variable === "wind" && s.u != null && s.v != null) windUv.set(ms, { u: s.u, v: s.v });
    }
  }

  const steps: ForecastStep[] = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ms, row]) => {
      const at = (variable: string): number | null =>
        row[variable] != null ? row[variable] : null;
      const temp = at("temp");
      const wind = at("wind");
      const gust = at("gust");
      const rain = at("rain");
      const cloud = at("cloud");
      const storm = at("storm");

      // Per-step hazards: one instantaneous value read as both min and max.
      const aggregates: DayAggregate[] = [];
      const push = (variable: string, v: number | null) => {
        if (v != null) aggregates.push({ variable, min: v, max: v });
      };
      push("gust", gust);
      push("temp", temp);
      push("rain", rain);
      push("storm", storm);
      const hazards = classifyForecastDay(aggregates);

      const local = new Date(ms + offset * 3600 * 1000);
      const dayKey = local.toISOString().slice(0, 10);
      return {
        t: new Date(ms).toISOString(),
        dayKey,
        dayLabel: humanDayLabel(dayKey, lng),
        hourLabel: local.toISOString().slice(11, 16),
        temp,
        wind,
        windDir: (() => {
          const uv = windUv.get(ms);
          return uv ? windDirection(uv.u, uv.v) : null;
        })(),
        gust,
        rain,
        cloud,
        storm,
        condition: deriveCondition({
          tempMin: temp ?? 20,
          rainMax: rain ?? 0,
          cloudAvg: cloud ?? 0,
          hazards,
        }),
        hazards,
      };
    });

  return { lat, lng, units, steps };
}

// ── Area forecast ───────────────────────────────────────────────────────────

export interface AreaDayMetric {
  mean: number;
  min: number;
  max: number;
}

export interface AreaForecastDay {
  date: string;
  label: ForecastDayLabel;
  temp: AreaDayMetric | null;
  wind: AreaDayMetric | null;
  gust: AreaDayMetric | null;
  rain: AreaDayMetric | null;
  cloud: AreaDayMetric | null;
  precipChance: number | null;
  condition: ForecastCondition;
  hazards: ForecastHazardFlag[];
}

export interface AreaForecastSeries {
  bbox: [number, number, number, number];
  units: Record<string, string>;
  days: AreaForecastDay[];
}

/**
 * Build daily card data over a bbox from the worker's pre-sampled area series.
 * Defaults to the detailed 3-day strip; pass a larger `maxDays` for the extended
 * outlook (the caller fetches with forecastHorizonHours(maxDays)).
 */
export async function buildAreaForecastDays(
  series: ForecastAreaSeries,
  bbox: [number, number, number, number],
  maxDays: number = DEFAULT_FORECAST_DAYS,
): Promise<AreaForecastSeries> {
  let centerLng = (bbox[0] + bbox[2]) / 2;
  if (bbox[2] < bbox[0]) centerLng = (((bbox[0] + bbox[2] + 360) / 2 + 180) % 360) - 180;

  const { units, samplesByVariable, allValidTimes } = series;

  const offset = localDayOffsetHours(centerLng);
  const dayKeys = bucketForecastDays(allValidTimes, centerLng, maxDays);

  const days: AreaForecastDay[] = dayKeys.map(({ date, label }) => {
    const forDay = (variable: string) =>
      (samplesByVariable[variable] ?? []).filter((s) => localDateKey(s.t, offset) === date);

    const dayAggregates: DayAggregate[] = [];
    const collect = (variable: string): AreaDayMetric | null => {
      const rows = forDay(variable);
      if (rows.length === 0) return null;
      const min = Math.min(...rows.map((r) => r.stats.min));
      const max = Math.max(...rows.map((r) => r.stats.max));
      const mean = rows.reduce((a, r) => a + r.stats.mean, 0) / rows.length;
      dayAggregates.push({ variable, min, max });
      return { mean, min, max };
    };

    const temp = collect("temp");
    const wind = collect("wind");
    const gust = collect("gust");
    const rain = collect("rain");
    const cloud = collect("cloud");
    collect("storm"); // hazard-only, not surfaced on the card

    const hazards = classifyForecastDay(dayAggregates);

    return {
      date,
      label,
      temp,
      wind,
      gust,
      rain,
      cloud,
      precipChance: rain ? precipChanceFromSteps(forDay("rain").map((r) => r.stats.mean)) : null,
      condition: deriveCondition({
        tempMin: temp?.min ?? 20,
        rainMax: rain?.max ?? 0,
        cloudAvg: cloud?.mean ?? 0,
        hazards,
      }),
      hazards,
    };
  });

  return { bbox, units, days };
}

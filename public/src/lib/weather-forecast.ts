// lib/weather-forecast.ts
// Server-side helpers for the /api/weather/forecast routes: turn raw 3-hourly
// WeatherForecastFrame steps into the daily hi/lo cards the broadcast strip
// shows (Today/Tomorrow/+2/+3), plus a derived hazard flag per day. Reuses the
// history feature's decode/sample/pick helpers directly (frames are the same
// shape) — no duplicated PNG-decode logic.

import {
  frameToSampleable,
  sampleFrameCached,
  pickFramesForPoint,
} from "./weather-history";
import { areaStatsFrame, type AreaStats } from "@photonsurge/shared/weather/sample";
import {
  classifyForecastDay,
  type DayAggregate,
  type ForecastHazardFlag,
} from "@photonsurge/shared/weather/forecastHazard";
import type { iWeatherForecastFrameModel } from "@photonsurge/shared/db/weather-forecast-frame-model";

export type ForecastDayLabel = "TODAY" | "TOMORROW" | "+2" | "+3";
export type ForecastCondition = "sunny" | "partly-cloudy" | "cloudy" | "rain" | "snow" | "storm";

/** A day-bucket key: which calendar day (at the point's local-hour offset) and its card label. */
export interface ForecastDayKey {
  key: string;
  label: ForecastDayLabel;
  date: string;
}

const DAY_LABELS: ForecastDayLabel[] = ["TODAY", "TOMORROW", "+2", "+3"];

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
 * Bucket every step's validTime into up to 4 calendar days (today + next 3)
 * from "now" at this point's approximate local offset. Steps outside that
 * window are dropped.
 */
export function bucketForecastDays(validTimes: Date[], lng: number): ForecastDayKey[] {
  const offset = localDayOffsetHours(lng);
  const todayMs = Date.parse(localDateKey(new Date(), offset));
  const byKey = new Map<string, number>();
  for (const t of validTimes) {
    const key = localDateKey(t, offset);
    const idx = Math.round((Date.parse(key) - todayMs) / 86_400_000);
    if (idx >= 0 && idx < DAY_LABELS.length && !byKey.has(key)) byKey.set(key, idx);
  }
  return [...byKey.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([date, idx]) => ({ key: date, label: DAY_LABELS[idx], date }));
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
  gustMax: number | null;
  precipChance: number | null;
  cloudAvg: number | null;
  condition: ForecastCondition;
  hazards: ForecastHazardFlag[];
}

export interface ForecastSeries {
  lat: number;
  lng: number;
  units: Record<string, string>;
  days: ForecastDay[];
}

interface VariableSample {
  t: Date;
  value: number;
}

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

/** Build the 3-day (today + next 3) daily card data for a point. */
export async function buildForecastDays(
  framesByVariable: Record<string, iWeatherForecastFrameModel[]>,
  lat: number,
  lng: number,
): Promise<ForecastSeries> {
  const units: Record<string, string> = {};
  const samplesByVariable: Record<string, VariableSample[]> = {};
  const allValidTimes: Date[] = [];

  for (const [variable, frames] of Object.entries(framesByVariable)) {
    const picked = pickFramesForPoint(frames as any, lat, lng);
    const samples: VariableSample[] = [];
    for (const frame of picked) {
      units[variable] = frame.units || units[variable] || "";
      const sample = await sampleFrameCached(frame as any, lat, lng);
      if (!sample) continue;
      const t = new Date(frame.validTime);
      samples.push({ t, value: sample.kind === "scalar" ? sample.value : sample.speed });
      allValidTimes.push(t);
    }
    samplesByVariable[variable] = samples;
  }

  const offset = localDayOffsetHours(lng);
  const dayKeys = bucketForecastDays(allValidTimes, lng);

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

    return {
      date,
      label,
      hiTemp: temp?.max ?? null,
      loTemp: temp?.min ?? null,
      windAvg: wind?.mean ?? null,
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

interface AreaVariableSample {
  t: Date;
  stats: AreaStats;
}

/** Build the 3-day (today + next 3) daily card data over a bbox. */
export async function buildAreaForecastDays(
  framesByVariable: Record<string, iWeatherForecastFrameModel[]>,
  bbox: [number, number, number, number],
): Promise<AreaForecastSeries> {
  const centerLat = (bbox[1] + bbox[3]) / 2;
  let centerLng = (bbox[0] + bbox[2]) / 2;
  if (bbox[2] < bbox[0]) centerLng = (((bbox[0] + bbox[2] + 360) / 2 + 180) % 360) - 180;

  const units: Record<string, string> = {};
  const samplesByVariable: Record<string, AreaVariableSample[]> = {};
  const allValidTimes: Date[] = [];

  for (const [variable, frames] of Object.entries(framesByVariable)) {
    const picked = pickFramesForPoint(frames as any, centerLat, centerLng);
    const samples: AreaVariableSample[] = [];
    for (const frame of picked) {
      units[variable] = frame.units || units[variable] || "";
      try {
        const grid = await frameToSampleable(frame as any);
        const areaStats = areaStatsFrame(grid, bbox);
        if (!areaStats) continue;
        const t = new Date(frame.validTime);
        samples.push({ t, stats: areaStats });
        allValidTimes.push(t);
      } catch {
        // undecodable frame reads as nodata for this variable/step
      }
    }
    samplesByVariable[variable] = samples;
  }

  const offset = localDayOffsetHours(centerLng);
  const dayKeys = bucketForecastDays(allValidTimes, centerLng);

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

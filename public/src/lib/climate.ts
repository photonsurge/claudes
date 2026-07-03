// lib/climate.ts
// Past-year daily climate for a point, from Open-Meteo's free ERA5 reanalysis
// archive (no key; the geocode route sets the precedent for public API routes
// calling an external service server-side). Our own WeatherFrame archive only
// accumulates from the day it was enabled, so "temperature over the last
// year" has to come from reanalysis. Daily values bucket into ISO weeks or
// calendar months for the director-mode charts. Responses are memoised
// in-process for a day — a year of history doesn't change under us.

/** One dataset over the past year: daily values aligned to `dates`. */
export interface ClimateDataset {
  variable: "temp" | "tempMax" | "tempMin" | "humidity" | "rain" | "wind";
  units: string;
  values: (number | null)[];
}

export interface ClimateYear {
  lat: number;
  lng: number;
  /** ISO YYYY-MM-DD, oldest first, ~365 entries. */
  dates: string[];
  datasets: ClimateDataset[];
}

/** How a dataset folds into a weekly/monthly bucket. */
const BUCKET_FOLD: Record<ClimateDataset["variable"], "mean" | "min" | "max" | "sum"> = {
  temp: "mean",
  tempMax: "max",
  tempMin: "min",
  humidity: "mean",
  rain: "sum",
  wind: "max",
};

/** Open-Meteo daily field → our dataset slot. */
const OM_DAILY: Array<{ om: string; variable: ClimateDataset["variable"]; units: string }> = [
  { om: "temperature_2m_mean", variable: "temp", units: "°C" },
  { om: "temperature_2m_max", variable: "tempMax", units: "°C" },
  { om: "temperature_2m_min", variable: "tempMin", units: "°C" },
  { om: "relative_humidity_2m_mean", variable: "humidity", units: "%" },
  { om: "precipitation_sum", variable: "rain", units: "mm" },
  { om: "wind_speed_10m_max", variable: "wind", units: "m/s" },
];

const ARCHIVE_URL = process.env.OPENMETEO_ARCHIVE_URL || "https://archive-api.open-meteo.com/v1/archive";

/** Parse the Open-Meteo daily payload into a ClimateYear. Pure. */
export function parseClimateYear(lat: number, lng: number, body: any): ClimateYear | null {
  const daily = body?.daily;
  const dates: string[] = daily?.time ?? [];
  if (!Array.isArray(dates) || dates.length === 0) return null;
  const datasets: ClimateDataset[] = [];
  for (const { om, variable, units } of OM_DAILY) {
    const values = daily[om];
    if (!Array.isArray(values)) continue;
    datasets.push({ variable, units, values: values.map((v: unknown) => (typeof v === "number" ? v : null)) });
  }
  return datasets.length ? { lat, lng, dates, datasets } : null;
}

/** Fetch ~the past year of daily reanalysis for a point (ERA5 lags ~5 days). */
export async function fetchClimateYear(lat: number, lng: number, today = new Date()): Promise<ClimateYear | null> {
  const end = new Date(today.getTime() - 5 * 86400e3);
  const start = new Date(end.getTime() - 365 * 86400e3);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    start_date: day(start),
    end_date: day(end),
    daily: OM_DAILY.map((d) => d.om).join(","),
    wind_speed_unit: "ms",
    timezone: "UTC",
  });
  try {
    const res = await fetch(`${ARCHIVE_URL}?${qs}`, { cache: "no-store" });
    if (!res.ok) return null;
    return parseClimateYear(lat, lng, await res.json());
  } catch {
    return null;
  }
}

// ── In-process memo (a year of reanalysis is stable; refresh daily) ────────
const CACHE_TTL_MS = 24 * 3600e3;
const CACHE_MAX = 500;
const cache = new Map<string, { at: number; data: ClimateYear | null }>();

export async function fetchClimateYearCached(lat: number, lng: number): Promise<ClimateYear | null> {
  // 0.1° key ≈ 11 km — plenty for climate context.
  const key = `${lat.toFixed(1)}|${lng.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = await fetchClimateYear(lat, lng);
  if (cache.size >= CACHE_MAX) cache.clear();
  // Don't memoise failures for a day — retry on the next request.
  if (data) cache.set(key, { at: Date.now(), data });
  return data;
}

// ── Weekly / monthly bucketing ──────────────────────────────────────────────

export interface ClimateBucket {
  /** Bucket label: "2026-03" (month) or the ISO week's Monday "2026-03-02". */
  key: string;
  mean: number;
  min: number;
  max: number;
  sum: number;
  count: number;
}

/** The Monday of an ISO date's week, as YYYY-MM-DD. */
export function isoWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Fold one dataset's daily values into weekly or monthly buckets (nulls are
 * skipped; empty buckets dropped). `value` on each bucket applies the
 * dataset's natural fold: means for temp/humidity, sum for rain, max for wind.
 */
export function bucketDaily(
  dates: string[],
  values: (number | null)[],
  granularity: "weekly" | "monthly",
): ClimateBucket[] {
  const buckets = new Map<string, { min: number; max: number; sum: number; count: number }>();
  for (let i = 0; i < dates.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    const key = granularity === "monthly" ? dates[i].slice(0, 7) : isoWeekStart(dates[i]);
    const b = buckets.get(key) ?? { min: Infinity, max: -Infinity, sum: 0, count: 0 };
    if (v < b.min) b.min = v;
    if (v > b.max) b.max = v;
    b.sum += v;
    b.count += 1;
    buckets.set(key, b);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, b]) => ({ key, mean: b.sum / b.count, min: b.min, max: b.max, sum: b.sum, count: b.count }));
}

/** The bucket reading a dataset should plot, per its natural fold. */
export function bucketValue(variable: ClimateDataset["variable"], b: ClimateBucket): number {
  const fold = BUCKET_FOLD[variable];
  if (fold === "sum") return b.sum;
  if (fold === "min") return b.min;
  if (fold === "max") return b.max;
  return b.mean;
}

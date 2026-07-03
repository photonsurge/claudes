// climate/buckets.ts
// Fold a year of daily climate values into ISO-week or calendar-month buckets
// for the director-mode charts. Pure; used by the public /climate route.

import type { ClimateBucket, ClimateDataset } from "./types";

/** How a dataset folds into a weekly/monthly bucket. */
const BUCKET_FOLD: Record<ClimateDataset["variable"], "mean" | "min" | "max" | "sum"> = {
  temp: "mean",
  tempMax: "max",
  tempMin: "min",
  humidity: "mean",
  rain: "sum",
  wind: "max",
};

/** The Monday of an ISO date's week, as YYYY-MM-DD. */
export function isoWeekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Fold one dataset's daily values into weekly or monthly buckets (nulls are
 * skipped; empty buckets dropped), oldest first.
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

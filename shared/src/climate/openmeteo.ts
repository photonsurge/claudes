// climate/openmeteo.ts
// ERA5 reanalysis fetch + parse (Open-Meteo archive API, free / no key).
// Called by the WORKER's climate job only — mirrors tides/ioc.ts, where shared
// owns the feed client and the worker owns when/what to cache.

import type { ClimateDataset, ClimateYear } from "./types";

/** Open-Meteo daily field → our dataset slot. Field names live-verified. */
export const OM_DAILY: Array<{ om: string; variable: ClimateDataset["variable"]; units: string }> = [
  { om: "temperature_2m_mean", variable: "temp", units: "°C" },
  { om: "temperature_2m_max", variable: "tempMax", units: "°C" },
  { om: "temperature_2m_min", variable: "tempMin", units: "°C" },
  { om: "relative_humidity_2m_mean", variable: "humidity", units: "%" },
  { om: "precipitation_sum", variable: "rain", units: "mm" },
  { om: "wind_speed_10m_max", variable: "wind", units: "m/s" },
];

const ARCHIVE_URL = () =>
  process.env.OPENMETEO_ARCHIVE_URL || "https://archive-api.open-meteo.com/v1/archive";

/** Parse the Open-Meteo daily payload into a ClimateYear. Pure. */
export function parseClimateYear(lat: number, lng: number, body: any): ClimateYear | null {
  const daily = body?.daily;
  const dates: string[] = daily?.time ?? [];
  if (!Array.isArray(dates) || dates.length === 0) return null;
  const datasets: ClimateDataset[] = [];
  for (const { om, variable, units } of OM_DAILY) {
    const values = daily[om];
    if (!Array.isArray(values)) continue;
    datasets.push({
      variable,
      units,
      values: values.map((v: unknown) => (typeof v === "number" ? v : null)),
    });
  }
  return datasets.length ? { lat, lng, dates, datasets } : null;
}

/** Fetch ~the past year of daily reanalysis for a point (ERA5 lags ~5 days). */
export async function fetchClimateYear(
  lat: number,
  lng: number,
  today = new Date(),
): Promise<ClimateYear | null> {
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
  const res = await fetch(`${ARCHIVE_URL()}?${qs}`);
  if (!res.ok) return null;
  return parseClimateYear(lat, lng, await res.json());
}

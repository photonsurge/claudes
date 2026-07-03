// climate/types.ts
// Past-year daily climate for a point, sourced from ERA5 reanalysis (the
// Open-Meteo archive API). The WORKER fetches and caches one doc per rounded
// focus point (public never calls the feed); the public /climate route reads
// the cache and folds days into weekly/monthly buckets for the director-mode
// year charts.

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

export interface ClimateBucket {
  /** Bucket label: "2026-03" (month) or the ISO week's Monday "2026-03-02". */
  key: string;
  mean: number;
  min: number;
  max: number;
  sum: number;
  count: number;
}

/** Cache key for a climate doc: 0.1° (~11 km) — plenty for climate context. */
export function climateKey(lat: number, lng: number): string {
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

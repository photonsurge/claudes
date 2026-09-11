/**
 * Weather → mood for the bed. The /watch surface already has the on-air
 * location's point-history series (wind, gust, rain, temp) and the aurora Kp;
 * this turns the latest readings into four 0..1 "mood" axes the engine maps
 * onto sound: windy → hat density + stereo motion + a wind bed, wet → rain
 * texture + longer delays, warm → brightness, aurora → a shimmer above the pad.
 * Pure functions; the shapes are structural so this stays free of app imports.
 */

/** Latest readings at the on-air point, native units (m/s, mm/h, °C, Kp 0–9). */
export interface BedWeather {
  wind?: number | null;
  gust?: number | null;
  rain?: number | null;
  temp?: number | null;
  kp?: number | null;
}

export interface Mood {
  windy: number;
  wet: number;
  warm: number;
  aurora: number;
}

export const NEUTRAL_MOOD: Mood = { windy: 0, wet: 0, warm: 0.5, aurora: 0 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Map readings onto the mood axes; unknown readings fall back to neutral. */
export function moodFrom(w: BedWeather): Mood {
  const wind = Math.max(num(w.wind) ?? 0, (num(w.gust) ?? 0) * 0.7);
  const rain = num(w.rain);
  const temp = num(w.temp);
  const kp = num(w.kp);
  return {
    windy: clamp01(wind / 14), // ~14 m/s (a near gale) = full
    wet: rain === null ? 0 : clamp01(rain / 3), // 3 mm/h = proper rain
    warm: temp === null ? 0.5 : clamp01((temp + 5) / 35), // -5 °C → 0, 30 °C → 1
    aurora: kp === null ? 0 : clamp01((kp - 2) / 5), // Kp 2 → 0, Kp 7 → 1
  };
}

/** Structural view of a shared HistorySeries — just what we read. */
export interface SeriesLike {
  variable: string;
  units?: string;
  series: { value?: number; speed?: number }[];
}

const toMps = (v: number, units?: string) => (units === "km/h" ? v / 3.6 : units === "kt" ? v * 0.5144 : units === "mph" ? v * 0.447 : v);
const toC = (v: number, units?: string) => (units === "K" ? v - 273.15 : units === "°F" || units === "F" ? ((v - 32) * 5) / 9 : v);

/** Latest sampled reading of a variable (scalars use `value`, vectors `speed`). */
export function latestReading(series: SeriesLike[], variable: string): { v: number; units?: string } | null {
  const s = series.find((x) => x.variable === variable);
  if (!s) return null;
  for (let i = s.series.length - 1; i >= 0; i--) {
    const p = s.series[i];
    const v = num(p.value) ?? num(p.speed);
    if (v !== null) return { v, units: s.units };
  }
  return null;
}

/** Readings for the bed from the focus bundle's point history + the aurora Kp. */
export function weatherFromSeries(series: SeriesLike[], kp: number | null): BedWeather {
  const wind = latestReading(series, "wind");
  const gust = latestReading(series, "gust");
  const rain = latestReading(series, "rain");
  const temp = latestReading(series, "temp");
  return {
    wind: wind ? toMps(wind.v, wind.units) : null,
    gust: gust ? toMps(gust.v, gust.units) : null,
    rain: rain ? (rain.units === "mm/h" || !rain.units ? rain.v : rain.v) : null,
    temp: temp ? toC(temp.v, temp.units) : null,
    kp,
  };
}

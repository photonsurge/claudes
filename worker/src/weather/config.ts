// weather/config.ts
// Ingest configuration plus small pure helpers for enumerating forecast steps
// and resolving a run's nominal Date. Kept dependency-free and pure so the
// boundaries are unit-testable.
//
// The horizons are deliberately HARDCODED (not env-driven): every environment
// bakes the same curve — a detailed 3-hourly track out to 72h, PLUS a coarser
// 12-hourly "daily outlook" out to the GFS ceiling (384h / 16 days) so the
// broadcast can reach for future days beyond the detailed window.

export interface WeatherConfig {
  model: string;
  forecastHours: number;
  stepHours: number;
  retainRuns: number;
  dailyHours: number;
  dailyStepHours: number;
}

/** Detailed 3-hourly track: f000..72h. */
export const FORECAST_HOURS = 72;
export const STEP_HOURS = 3;
/** Extended daily outlook: 12-hourly f000..384h (16 days, the GFS ceiling). */
export const DAILY_HOURS = 384;
export const DAILY_STEP_HOURS = 12;
/** Published runs kept before retention prunes. */
export const RETAIN_RUNS = 3;

/** Hardcoded ingest config. Intentionally NOT env-driven — see file header. */
export function cfg(): WeatherConfig {
  return {
    model: "gfs",
    forecastHours: FORECAST_HOURS,
    stepHours: STEP_HOURS,
    retainRuns: RETAIN_RUNS,
    dailyHours: DAILY_HOURS,
    dailyStepHours: DAILY_STEP_HOURS,
  };
}

/**
 * Feature flag: when true, the atmospheric base is ECMWF IFS instead of GFS
 * (GFS stays wired as the failover). Off by default — IFS lags ~9h and must be
 * validated per §11 before becoming the default. Read at the boundary (director/
 * check) so it can flip without a rebuild.
 */
export function ifsAsDefaultBase(): boolean {
  return process.env.IFS_AS_DEFAULT_BASE === "true";
}

/** Forecast steps f000..forecastHours by stepHours (stepHours floored at 1). */
export function forecastSteps(forecastHours: number, stepHours: number): number[] {
  const out: number[] = [];
  for (let f = 0; f <= forecastHours; f += Math.max(1, stepHours)) out.push(f);
  return out;
}

/**
 * The full set of forecast hours a run bakes: the detailed 3-hourly track
 * (0..forecastHours) unioned with the coarser daily outlook (0..dailyHours by
 * dailyStepHours), de-duplicated and sorted ascending. Below forecastHours the
 * two overlap (12 is a multiple of 3), so the only extra frames are the >72h
 * daily steps (84, 96 … 384). Each 12-hourly step is a valid GFS lead hour, so
 * no cadence special-casing is needed.
 */
export function bakeSteps(c: WeatherConfig): number[] {
  const set = new Set<number>(forecastSteps(c.forecastHours, c.stepHours));
  for (let f = 0; f <= c.dailyHours; f += Math.max(1, c.dailyStepHours)) set.add(f);
  return [...set].sort((a, b) => a - b);
}

/** Resolve the nominal run Date (UTC) from a YYYYMMDD date + HH cycle. */
export function runDateFor(date: string, cycle: string): Date {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6)) - 1;
  const d = Number(date.slice(6, 8));
  return new Date(Date.UTC(y, mo, d, Number(cycle), 0, 0, 0));
}

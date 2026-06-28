// weather/config.ts
// Env-driven ingest configuration plus small pure helpers for enumerating
// forecast steps and resolving a run's nominal Date. Kept dependency-free and
// pure so the boundaries are unit-testable.

export interface WeatherConfig {
  model: string;
  forecastHours: number;
  stepHours: number;
  retainRuns: number;
}

/** Read ingest config from the environment, applying the production defaults. */
export function cfg(): WeatherConfig {
  return {
    model: process.env.MODEL || "gfs",
    forecastHours: Number(process.env.FORECAST_HOURS || 48),
    stepHours: Number(process.env.STEP_HOURS || 3),
    retainRuns: Number(process.env.RETAIN_RUNS || 3),
  };
}

/** Forecast steps f000..forecastHours by stepHours (stepHours floored at 1). */
export function forecastSteps(forecastHours: number, stepHours: number): number[] {
  const out: number[] = [];
  for (let f = 0; f <= forecastHours; f += Math.max(1, stepHours)) out.push(f);
  return out;
}

/** Resolve the nominal run Date (UTC) from a YYYYMMDD date + HH cycle. */
export function runDateFor(date: string, cycle: string): Date {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(4, 6)) - 1;
  const d = Number(date.slice(6, 8));
  return new Date(Date.UTC(y, mo, d, Number(cycle), 0, 0, 0));
}

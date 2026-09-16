// lib/worker-sample.ts
// Public → worker sampling client. The worker is the sole frame decoder (it has
// sharp + reads frame bytes from the shared blob store); public asks it for the
// small numeric series instead of decoding weather PNGs in the user-facing Next
// process. Fail-OPEN: if the worker is unreachable we return an empty series so a
// history chart renders blank rather than 500ing (catalog entities are still
// served from the weatherPanels Redis precompute, which doesn't need the worker).
import type { HistorySeries, AreaHistorySeries } from "@photonsurge/shared/weather/history-types";
import type { AreaStats } from "@photonsurge/shared/weather/sample";

const WORKER_URL = process.env.WORKER_INTERNAL_URL || "http://localhost:10102";
const TIMEOUT_MS = Number(process.env.WORKER_SAMPLE_TIMEOUT_MS || 20_000);

async function post<T>(path: string, body: unknown, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export interface WorkerPointHistoryArgs {
  variable: string;
  lat: number;
  lng: number;
  from?: string | number;
  to?: string | number;
  model?: string;
}

export function workerPointHistory(a: WorkerPointHistoryArgs): Promise<HistorySeries> {
  const empty: HistorySeries = {
    variable: a.variable,
    encoding: "scalar",
    units: "",
    lat: a.lat,
    lng: a.lng,
    series: [],
    stats: null,
  };
  return post("/internal/weather/history/point", a, empty);
}

export interface WorkerAreaHistoryArgs {
  variable: string;
  bbox: [number, number, number, number];
  from?: string | number;
  to?: string | number;
  model?: string;
}

export function workerAreaHistory(a: WorkerAreaHistoryArgs): Promise<AreaHistorySeries> {
  const empty: AreaHistorySeries = {
    variable: a.variable,
    encoding: "scalar",
    units: "",
    bbox: a.bbox,
    series: [],
    stats: null,
    areaMin: null,
    areaMax: null,
  };
  return post("/internal/weather/history/area", a, empty);
}

// ── Forecast sampling (worker decodes; public composes the day cards) ─────────

/** One sampled forecast step: the physical reading (SPEED for a uv variable),
 *  plus the raw u/v components when the frame was a vector one — that's what
 *  lets the day cards show wind DIRECTION without decoding frames in public. */
export interface ForecastPointSample {
  t: Date;
  value: number;
  u?: number;
  v?: number;
}

/** Point forecast series with `t` hydrated back to Date + the flat validTime union. */
export interface ForecastPointSeries {
  units: Record<string, string>;
  samplesByVariable: Record<string, ForecastPointSample[]>;
  allValidTimes: Date[];
}

/** Area forecast series (per-frame area stats), `t` hydrated to Date. */
export interface ForecastAreaSeries {
  units: Record<string, string>;
  samplesByVariable: Record<string, { t: Date; stats: AreaStats }[]>;
  allValidTimes: Date[];
}

export interface WorkerForecastPointArgs {
  lat: number;
  lng: number;
  variables: string[];
  model?: string;
  maxHours?: number;
}

export interface WorkerForecastAreaArgs {
  bbox: [number, number, number, number];
  variables: string[];
  model?: string;
  maxHours?: number;
}

export async function workerForecastPoint(a: WorkerForecastPointArgs): Promise<ForecastPointSeries> {
  const wire = await post<{
    units: Record<string, string>;
    samplesByVariable: Record<string, { t: string; value: number; u?: number; v?: number }[]>;
  }>(
    "/internal/weather/forecast/point",
    a,
    { units: {}, samplesByVariable: {} },
  );
  const samplesByVariable: Record<string, ForecastPointSample[]> = {};
  const allValidTimes: Date[] = [];
  for (const [v, rows] of Object.entries(wire.samplesByVariable ?? {})) {
    samplesByVariable[v] = rows.map((r) => {
      const t = new Date(r.t);
      allValidTimes.push(t);
      return { t, value: r.value, ...(r.u != null && r.v != null ? { u: r.u, v: r.v } : {}) };
    });
  }
  return { units: wire.units ?? {}, samplesByVariable, allValidTimes };
}

export async function workerForecastArea(a: WorkerForecastAreaArgs): Promise<ForecastAreaSeries> {
  const wire = await post<{ units: Record<string, string>; samplesByVariable: Record<string, { t: string; stats: AreaStats }[]> }>(
    "/internal/weather/forecast/area",
    a,
    { units: {}, samplesByVariable: {} },
  );
  const samplesByVariable: Record<string, { t: Date; stats: AreaStats }[]> = {};
  const allValidTimes: Date[] = [];
  for (const [v, rows] of Object.entries(wire.samplesByVariable ?? {})) {
    samplesByVariable[v] = rows.map((r) => {
      const t = new Date(r.t);
      allValidTimes.push(t);
      return { t, stats: r.stats };
    });
  }
  return { units: wire.units ?? {}, samplesByVariable, allValidTimes };
}

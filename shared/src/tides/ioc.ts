import type { TideSample, TideStation } from "./types";

/**
 * IOC Sea Level Monitoring Facility (UNESCO/VLIZ) — a ~900-station GLOBAL network
 * of coastal tide gauges with keyless JSON. Two queries off one endpoint:
 *   - `stationlist` → the catalog (one row per station×sensor).
 *   - `data&code=..&period=..` → a station's recent readings `{slevel,stime,sensor}`.
 * The worker polls a handful of stations (those near what's on air) into Mongo;
 * the public app only ever reads that cache. Docs: ioc-sealevelmonitoring.org.
 */
const BASE = "http://www.ioc-sealevelmonitoring.org/service.php";
const UA = "LiveWeatherGlobe/0.1 (personal weather globe)";

/**
 * Sensor channels that report sea level, most-preferred first (radar/pressure/
 * float/bubbler gauges). Anything not here (battery `bat`, met sensors, …) is
 * ignored so the gauge never plots voltage. Used both to pick a station's
 * canonical channel and to filter its readings.
 */
const WATER_SENSORS = [
  "prs", "rad", "ra2", "ra3", "pwl", "wls", "flt",
  "bub", "enc", "ecs", "aqu", "pr1", "pr2", "bwl", "atd",
] as const;

const sensorRank = (s: string): number => {
  const i = (WATER_SENSORS as readonly string[]).indexOf(s.toLowerCase());
  return i === -1 ? Number.POSITIVE_INFINITY : i;
};
const isWaterSensor = (s: string): boolean => sensorRank(s) !== Number.POSITIVE_INFINITY;

/** Case-tolerant field pluck (IOC mixes `lat`/`Lat`, `lon`/`Lon`, …). */
const pick = (o: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) {
    if (o[k] != null) return o[k];
    const lk = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
    if (lk && o[lk] != null) return o[lk];
  }
  return undefined;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
};

/** IOC stamps are UTC "YYYY-MM-DD HH:MM:SS". */
const parseTime = (s: unknown): number => {
  const t = Date.parse(String(s).replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : 0;
};

/** Parse a `stationlist` payload → one `TideStation` per code (best sensor). */
export function parseStations(json: unknown): TideStation[] {
  if (!Array.isArray(json)) return [];
  const byCode = new Map<string, TideStation>();
  for (const raw of json as Record<string, unknown>[]) {
    const code = String(pick(raw, "Code", "code") ?? "").trim();
    const sensor = String(pick(raw, "sensor") ?? "").trim().toLowerCase();
    const lat = num(pick(raw, "lat", "Lat"));
    const lng = num(pick(raw, "lon", "Lon", "lng"));
    if (!code || lat === undefined || lng === undefined) continue;
    // A dead station or a non-sea-level channel is no use to the gauge.
    const status = String(pick(raw, "status") ?? "1");
    if (status !== "1") continue;
    if (sensor && !isWaterSensor(sensor)) continue;
    const station: TideStation = {
      stationId: code,
      provider: "ioc",
      name: String(pick(raw, "Location", "location", "name") ?? code).trim() || code,
      lat,
      lng,
      country: (String(pick(raw, "country") ?? "").trim() || undefined) as string | undefined,
      sensor: sensor || undefined,
    };
    const prev = byCode.get(code);
    // Keep the highest-priority water-level channel for the station.
    if (!prev || sensorRank(sensor) < sensorRank(prev.sensor ?? "")) byCode.set(code, station);
  }
  return [...byCode.values()];
}

/** Parse a `data` payload → water-level samples (metres), oldest→newest. */
export function parseSeries(json: unknown, sensor?: string): TideSample[] {
  if (!Array.isArray(json)) return [];
  const rows = json as Record<string, unknown>[];
  // Prefer the requested channel; else the best water-level channel present.
  let chan = sensor?.toLowerCase();
  if (!chan) {
    const present = new Set(
      rows.map((r) => String(pick(r, "sensor") ?? "").toLowerCase()).filter(isWaterSensor),
    );
    chan = [...present].sort((a, b) => sensorRank(a) - sensorRank(b))[0];
  }
  const out: TideSample[] = [];
  for (const r of rows) {
    const s = String(pick(r, "sensor") ?? "").toLowerCase();
    if (chan && s && s !== chan) continue;
    if (!chan && !isWaterSensor(s)) continue;
    const v = num(pick(r, "slevel", "level", "value"));
    const t = parseTime(pick(r, "stime", "time"));
    if (v === undefined || !t) continue;
    out.push({ t, v });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Fetch the full IOC station catalog. */
export async function fetchStations(): Promise<TideStation[]> {
  const res = await fetch(`${BASE}?query=stationlist&format=json`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ioc stationlist failed: ${res.status} ${res.statusText}`);
  return parseStations(await res.json());
}

/** Fetch one station's recent water-level series (last `hours`, default 6h). */
export async function fetchSeries(
  stationId: string,
  hours = 6,
  sensor?: string,
): Promise<TideSample[]> {
  const period = Math.max(0.05, hours / 24); // IOC `period` is in days.
  const q = new URLSearchParams({ query: "data", code: stationId, period: String(period), format: "json" });
  const res = await fetch(`${BASE}?${q.toString()}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ioc data failed (${stationId}): ${res.status} ${res.statusText}`);
  return parseSeries(await res.json(), sensor);
}

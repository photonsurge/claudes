/**
 * Round-up aggregation: read every currently-active weather event out of Mongo
 * (alerts, quakes, notable tracks) and reduce it to the deterministic facts a
 * round-up is built from — headline stats, cross-kind geographic hotspots, and a
 * ranked list of the most notable events. Pure helpers (`clusterHotspots`,
 * `regionLabel`, `walkBbox`) are unit-tested; `aggregate` orchestrates the reads.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import { classifyHazard } from "@photonsurge/shared/alerts/hazard";
import { countryContaining } from "@photonsurge/shared/director-countries";
import type {
  SummaryPeriod,
  iSummaryStats,
  iSummaryHotspot,
  iSummaryTopEvent,
} from "@photonsurge/shared/db/event-summary-model";

/** Lookback window per cadence, in hours. */
export const WINDOW_HOURS: Record<SummaryPeriod, number> = { hourly: 1, "12h": 12, daily: 24 };

/** USGS magnitude → the shared 0–4 severity scale (so quakes cluster with alerts). */
export function magToSeverity(mag: number): SeverityRank {
  if (mag >= 6) return 4;
  if (mag >= 5) return 3;
  if (mag >= 4) return 2;
  return 1;
}

/** Walk arbitrarily-nested GeoJSON coordinates down to [lng,lat] pairs. */
function walkCoords(coords: unknown, fn: (x: number, y: number) => void): void {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    fn(coords[0] as number, coords[1] as number);
    return;
  }
  for (const c of coords) walkCoords(c, fn);
}

/** Bounding-box midpoint over every area geometry of an alert, or null if none. */
export function alertCentroid(alert: {
  info?: { area?: { geometry?: { coordinates?: unknown } | null }[] }[];
}): { lng: number; lat: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const info of alert.info ?? []) {
    for (const area of info.area ?? []) {
      const g = area.geometry;
      if (!g || !g.coordinates) continue;
      walkCoords(g.coordinates, (x, y) => {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      });
    }
  }
  return found ? { lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 } : null;
}

/** A human label for a coordinate — the curated country name when the point
 *  falls inside one (so a hotspot reads "France", not a raw coordinate),
 *  else a coarse continent/ocean bucket as a fallback. */
export function regionLabel(lng: number, lat: number): string {
  const country = countryContaining(lng, lat);
  if (country) return country.name;
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  const coord = `${Math.abs(lat).toFixed(0)}°${ns}, ${Math.abs(lng).toFixed(0)}°${ew}`;
  const region = coarseRegion(lng, lat);
  return region ? `${region} (${coord})` : coord;
}

/** Very coarse continent/ocean bucketing by bounding box. Best-effort only. */
function coarseRegion(lng: number, lat: number): string | null {
  const inBox = (w: number, s: number, e: number, n: number) =>
    lng >= w && lng <= e && lat >= s && lat <= n;
  if (inBox(-170, 15, -50, 72)) return "North America";
  if (inBox(-82, -56, -34, 13)) return "South America";
  if (inBox(-25, 34, 45, 72)) return "Europe";
  if (inBox(-20, -35, 52, 37)) return "Africa";
  if (inBox(45, 5, 90, 60)) return "South & Central Asia";
  if (inBox(90, 5, 150, 60)) return "East Asia";
  if (inBox(95, -11, 141, 8)) return "Southeast Asia";
  if (inBox(110, -47, 180, -10)) return "Australia & Oceania";
  if (inBox(25, 12, 60, 42)) return "Middle East";
  return null;
}

export interface HotspotPoint {
  lng: number;
  lat: number;
  sev: SeverityRank;
  hazard?: string;
  kind: string;
}

/**
 * Grid-bucket clustering across all event kinds: snap each point to a `cellDeg`
 * cell and merge everything in the same cell into one hotspot. Cross-kind by
 * design — a quake next to a flood warning is one hotspot. Sorted by severity
 * then count, densest first.
 */
export function clusterHotspots(points: HotspotPoint[], cellDeg = 5): iSummaryHotspot[] {
  const cells = new Map<
    string,
    { lngSum: number; latSum: number; count: number; maxSeverity: SeverityRank; hazards: Set<string>; kinds: Set<string> }
  >();
  for (const p of points) {
    const cx = Math.floor(p.lng / cellDeg);
    const cy = Math.floor(p.lat / cellDeg);
    const key = `${cx}:${cy}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { lngSum: 0, latSum: 0, count: 0, maxSeverity: 0, hazards: new Set(), kinds: new Set() };
      cells.set(key, cell);
    }
    cell.lngSum += p.lng;
    cell.latSum += p.lat;
    cell.count += 1;
    if (p.sev > cell.maxSeverity) cell.maxSeverity = p.sev;
    if (p.hazard) cell.hazards.add(p.hazard);
    cell.kinds.add(p.kind);
  }

  const hotspots: iSummaryHotspot[] = [];
  for (const cell of cells.values()) {
    const lng = cell.lngSum / cell.count;
    const lat = cell.latSum / cell.count;
    hotspots.push({
      label: regionLabel(lng, lat),
      lng,
      lat,
      count: cell.count,
      maxSeverity: cell.maxSeverity,
      hazards: [...cell.hazards].sort(),
      kinds: [...cell.kinds].sort(),
    });
  }
  hotspots.sort((a, b) => b.maxSeverity - a.maxSeverity || b.count - a.count);
  return hotspots;
}

export interface AggregateResult {
  windowStart: string;
  windowEnd: string;
  stats: iSummaryStats;
  hotspots: iSummaryHotspot[];
  topEvents: iSummaryTopEvent[];
  sources: string[];
}

const TOP_EVENTS = 12;

/**
 * Read active events for `period` and reduce them to `{stats, hotspots,
 * topEvents}`. Alerts are the whole active set (global); quakes are the recent
 * feed clipped by magnitude; notable tracks are counted only (low priority).
 */
export async function aggregate(
  db: AppDb,
  period: SummaryPeriod,
  now: Date = new Date(),
): Promise<AggregateResult> {
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - WINDOW_HOURS[period] * 3_600_000);

  const alerts = await db.alerts.list({ activeOnly: true });
  const quakes = await db.quakes.list({ minMag: 2.5 });
  const ships = await db.trackSnapshots.latest({ kind: "ship" }).catch(() => ({ at: null, rows: [] }));

  const points: HotspotPoint[] = [];
  const topEvents: iSummaryTopEvent[] = [];

  // ---- Alerts ----
  const bySeverity: Record<string, number> = {};
  const byHazard: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const sources = new Set<string>();
  let cyclones = 0;

  for (const a of alerts) {
    const info = a.info?.[0];
    const hazard = classifyHazard({ event: info?.event, parameters: info?.parameters });
    const sev = (a.maxSeverityRank ?? 0) as SeverityRank;
    bySeverity[String(sev)] = (bySeverity[String(sev)] ?? 0) + 1;
    byHazard[hazard] = (byHazard[hazard] ?? 0) + 1;
    bySource[a.source] = (bySource[a.source] ?? 0) + 1;
    sources.add(a.source);
    if (hazard === "cyclone") cyclones += 1;

    const c = alertCentroid(a);
    if (c) points.push({ lng: c.lng, lat: c.lat, sev, hazard, kind: "alert" });
    topEvents.push({
      kind: "alert",
      refId: a.id ?? a.identifier,
      title: info?.headline || info?.event || a.identifier,
      severity: sev,
      hazard,
      lng: c?.lng,
      lat: c?.lat,
      at: info?.onset || a.sent || undefined,
      source: a.source,
    });
  }

  // ---- Quakes ----
  let quakeMaxMag = 0;
  for (const q of quakes) {
    const sev = magToSeverity(q.mag);
    if (q.mag > quakeMaxMag) quakeMaxMag = q.mag;
    points.push({ lng: q.lng, lat: q.lat, sev, hazard: "earthquake", kind: "quake" });
    topEvents.push({
      kind: "quake",
      refId: q.quakeId,
      title: `M${q.mag.toFixed(1)} — ${q.place ?? "earthquake"}`,
      severity: sev,
      hazard: "earthquake",
      lng: q.lng,
      lat: q.lat,
      at: q.time instanceof Date ? q.time.toISOString() : String(q.time),
      source: "usgs",
    });
  }
  if (quakes.length) sources.add("usgs");

  const tracksNotable = ships.rows.length;
  if (tracksNotable) sources.add("tracks:ship");

  const stats: iSummaryStats = {
    alertsActive: alerts.length,
    alertsBySeverity: bySeverity,
    alertsByHazard: byHazard,
    alertsBySource: bySource,
    quakeCount: quakes.length,
    quakeMaxMag,
    cyclones,
    tracksNotable,
  };

  // Rank top events by severity (quake magnitude breaks ties for quakes) then recency.
  topEvents.sort(
    (x, y) => y.severity - x.severity || Date.parse(y.at ?? "") - Date.parse(x.at ?? ""),
  );

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    stats,
    hotspots: clusterHotspots(points),
    topEvents: topEvents.slice(0, TOP_EVENTS),
    sources: [...sources].sort(),
  };
}

/**
 * Extension hook (future phase): derive storm hotspots directly from GFS
 * storm/gust grids rather than only GDACS cyclone alerts. No-op for now.
 */
export function gfsStormHotspots(): iSummaryHotspot[] {
  return [];
}

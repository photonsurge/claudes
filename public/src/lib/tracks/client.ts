import type { Aircraft, Quake, SatellitePosition, Ship, TleRecord } from "./types";
import type { TideStationsResponse } from "../tides/types";
import type { SeismoStationsResponse } from "../seismo/types";

export interface SatellitesResponse {
  group: string;
  count: number;
  total: number;
  at: string;
  satellites: SatellitePosition[];
}

/** Fetch propagated satellite positions for a group from the API. */
export async function listSatellites(group: string, limit?: number): Promise<SatellitesResponse> {
  const q = new URLSearchParams({ group });
  if (limit) q.set("limit", String(limit));
  const res = await fetch(`/api/tracks/satellites?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    return { group, count: 0, total: 0, at: new Date().toISOString(), satellites: [] };
  }
  return body as SatellitesResponse;
}

/** Fetch the raw TLEs for a group (for client-side SGP4 in the overlay). */
export async function fetchSatelliteTles(group: string, limit?: number): Promise<TleRecord[]> {
  const q = new URLSearchParams({ group, format: "tle" });
  if (limit) q.set("limit", String(limit));
  const res = await fetch(`/api/tracks/satellites?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.tles) ? (body.tles as TleRecord[]) : [];
}

export interface AircraftResponse {
  count: number;
  total: number;
  at: string;
  aircraft: Aircraft[];
  error?: string;
}

/** Live ADS-B aircraft snapshot. `bbox` is [w,s,e,n]. */
export async function listAircraft(
  bbox?: [number, number, number, number],
  limit?: number,
): Promise<AircraftResponse> {
  const q = new URLSearchParams();
  if (bbox) q.set("bbox", bbox.join(","));
  if (limit) q.set("limit", String(limit));
  const res = await fetch(`/api/tracks/aircraft?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!body) return { count: 0, total: 0, at: new Date().toISOString(), aircraft: [] };
  return body as AircraftResponse;
}

export interface ShipsResponse {
  configured: boolean;
  count: number;
  at?: string;
  ships: Ship[];
  note?: string;
  error?: string;
}

/** AIS ship snapshot. `bbox` is [w,s,e,n]. */
export async function listShips(bbox?: [number, number, number, number]): Promise<ShipsResponse> {
  const q = new URLSearchParams();
  if (bbox) q.set("bbox", bbox.join(","));
  const res = await fetch(`/api/tracks/ships?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!body) return { configured: false, count: 0, ships: [], note: "Request failed." };
  return body as ShipsResponse;
}

export interface QuakesResponse {
  count: number;
  quakes: Quake[];
  error?: string;
}

/** Worker-cached USGS earthquakes. `bbox` is [w,s,e,n]; `minMag` floors magnitude. */
export async function listQuakes(
  bbox?: [number, number, number, number],
  minMag?: number,
): Promise<QuakesResponse> {
  const q = new URLSearchParams();
  if (bbox) q.set("bbox", bbox.join(","));
  if (minMag != null) q.set("minMag", String(minMag));
  const res = await fetch(`/api/tracks/seismic?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!body) return { count: 0, quakes: [] };
  return body as QuakesResponse;
}

/**
 * Worker-cached sea-level series for the tide gauges nearest `[lng,lat]`
 * (plural — the panel cycles through them, like the seismic feed). Returns
 * `{ stations: [] }` when none are within range.
 */
export async function getTideStations(lat: number, lng: number, maxKm?: number): Promise<TideStationsResponse> {
  const q = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  if (maxKm != null) q.set("maxKm", String(maxKm));
  const res = await fetch(`/api/tracks/tide?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!body) return { stations: [] };
  return body as TideStationsResponse;
}

/**
 * Worker-cached live seismograph series for the stations nearest `[lng,lat]`
 * (plural — the panel cycles through them). Returns `{ stations: [] }` when
 * none are within range.
 */
export async function getSeismoStations(lat: number, lng: number, maxKm?: number): Promise<SeismoStationsResponse> {
  const q = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  if (maxKm != null) q.set("maxKm", String(maxKm));
  const res = await fetch(`/api/tracks/seismo?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!body) return { stations: [] };
  return body as SeismoStationsResponse;
}

// ── Position-history replay ────────────────────────────────────────────────
export type SnapshotKind = "aircraft" | "ship";

export interface SnapshotRow {
  kind: SnapshotKind;
  externalId: string;
  name?: string;
  lng: number;
  lat: number;
  altM?: number;
  headingDeg?: number;
  /** m/s for aircraft, knots for ships. */
  speed?: number;
  region?: string;
}

/** Available replay-frame timestamps (newest first) in the last `hours`. */
export async function listHistoryBatches(hours: number, kind?: SnapshotKind): Promise<string[]> {
  const q = new URLSearchParams({ hours: String(hours) });
  if (kind) q.set("kind", kind);
  const res = await fetch(`/api/tracks/history/batches?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.batches) ? (body.batches as string[]) : [];
}

/** The snapshots of one replay frame. */
export async function listHistoryAt(at: string, kind?: SnapshotKind): Promise<SnapshotRow[]> {
  const q = new URLSearchParams({ at });
  if (kind) q.set("kind", kind);
  const res = await fetch(`/api/tracks/history?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.snapshots) ? (body.snapshots as SnapshotRow[]) : [];
}

/** One track's recent route: positions oldest→newest as [lng, lat] pairs. */
export interface TrackPath {
  externalId: string;
  kind: SnapshotKind;
  name?: string;
  path: [number, number][];
}

/**
 * Per-track trailing paths over the last `minutes` (the live trails overlay).
 * `ids` scopes to a specific set of externalIds (on-air + notable craft) so the
 * server aggregates a handful of routes instead of one per track worldwide.
 */
export async function listTrackPaths(
  minutes: number,
  kind?: SnapshotKind,
  ids?: string[],
): Promise<TrackPath[]> {
  const q = new URLSearchParams({ minutes: String(minutes) });
  if (kind) q.set("kind", kind);
  if (ids && ids.length) q.set("ids", ids.join(","));
  const res = await fetch(`/api/tracks/history/paths?${q.toString()}`, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  return Array.isArray(body?.paths) ? (body.paths as TrackPath[]) : [];
}

/**
 * External ids (lowercased) of the curated notable catalog, grouped by kind.
 * These plus the on-air craft are the only tracks the trails overlay draws a
 * route behind — a trail per live track worldwide was illegible and slow.
 */
export async function listNotableCodes(): Promise<{ aircraft: string[]; ship: string[] }> {
  const out = { aircraft: [] as string[], ship: [] as string[] };
  try {
    const res = await fetch(`/api/vehicles?notable=1`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    const vehicles: { kind?: string; code?: string }[] = Array.isArray(body?.vehicles) ? body.vehicles : [];
    for (const v of vehicles) {
      if (!v?.code) continue;
      if (v.kind === "aircraft" || v.kind === "ship") out[v.kind].push(String(v.code).toLowerCase());
    }
  } catch {
    /* offline / not configured → no notable trails, on-air still works */
  }
  return out;
}


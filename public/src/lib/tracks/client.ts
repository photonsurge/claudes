import type { Aircraft, SatellitePosition, Ship, TleRecord } from "./types";

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


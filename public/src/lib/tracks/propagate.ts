import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from "satellite.js";
import type { SatellitePosition, TleRecord } from "./types";

/**
 * Propagate one TLE to a geodetic position at `date` via SGP4 (satellite.js).
 * Returns null for decayed/unsolvable elements so callers can filter. Pure and
 * deterministic — the same engine the map overlay will use client-side later.
 */
export function propagateOne(tle: TleRecord, date: Date): SatellitePosition | null {
  let satrec;
  try {
    satrec = twoline2satrec(tle.line1, tle.line2);
  } catch {
    return null;
  }
  const pv = propagate(satrec, date);
  if (!pv || typeof pv.position === "boolean" || !pv.position) return null;

  const gmst = gstime(date);
  const geo = eciToGeodetic(pv.position, gmst);
  const lat = degreesLat(geo.latitude);
  const lng = degreesLong(geo.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const v = pv.velocity;
  const speedKmS =
    v && typeof v !== "boolean" ? Math.hypot(v.x, v.y, v.z) : 0;

  return {
    noradId: tle.noradId,
    name: tle.name,
    lng,
    lat,
    altKm: geo.height,
    speedKmS,
  };
}

/** Propagate many TLEs, dropping any that fail. */
export function propagateAll(tles: TleRecord[], date: Date): SatellitePosition[] {
  const out: SatellitePosition[] = [];
  for (const t of tles) {
    const p = propagateOne(t, date);
    if (p) out.push(p);
  }
  return out;
}

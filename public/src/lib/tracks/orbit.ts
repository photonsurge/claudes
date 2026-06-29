import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from "satellite.js";
import type { TleRecord } from "./types";

/**
 * Satellite orbit rings: propagate one full period and emit the path at true
 * altitude so it floats above the sphere. Paths are split at the antimeridian
 * (|Δlng| > 180) so they don't streak across the globe.
 */
export interface OrbitSegment {
  id: string;
  /** [lng, lat, altMeters]. */
  path: [number, number, number][];
}

export function satelliteOrbit(tle: TleRecord, now: Date, samples = 90): OrbitSegment[] {
  let satrec;
  try {
    satrec = twoline2satrec(tle.line1, tle.line2);
  } catch {
    return [];
  }
  // satrec.no is mean motion in radians/minute → period = 2π/no minutes.
  const periodMin = (2 * Math.PI) / satrec.no;
  if (!Number.isFinite(periodMin) || periodMin <= 0) return [];

  const segs: OrbitSegment[] = [];
  let cur: [number, number, number][] = [];
  let seg = 0;
  let prevLng: number | null = null;

  const flush = () => {
    if (cur.length > 1) segs.push({ id: `${tle.noradId}:${seg++}`, path: cur });
    cur = [];
  };

  for (let i = 0; i <= samples; i++) {
    const t = new Date(now.getTime() + (periodMin * 60000 * i) / samples);
    const pv = propagate(satrec, t);
    if (!pv || typeof pv.position === "boolean" || !pv.position) continue;
    const geo = eciToGeodetic(pv.position, gstime(t));
    const lng = degreesLong(geo.longitude);
    const lat = degreesLat(geo.latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (prevLng !== null && Math.abs(lng - prevLng) > 180) flush();
    cur.push([lng, lat, geo.height * 1000]);
    prevLng = lng;
  }
  flush();
  return segs;
}

/** Orbit segments for many satellites (capped for performance). */
export function orbitSegments(tles: TleRecord[], now: Date, cap = 500): OrbitSegment[] {
  const out: OrbitSegment[] = [];
  for (const tle of tles.slice(0, cap)) out.push(...satelliteOrbit(tle, now));
  return out;
}

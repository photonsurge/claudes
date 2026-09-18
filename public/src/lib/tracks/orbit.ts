import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from "satellite.js";
import type { TleRecord } from "./types";

/**
 * Satellite orbit rings: propagate one full period and emit the path at true
 * altitude so it floats above the sphere. Paths are split at the antimeridian
 * (|Δlng| > 180) so they don't streak across the globe.
 *
 * The whole period is converted to ground coordinates through ONE Earth rotation
 * angle — `gstime(now)`, the planet's orientation at the instant the ring is
 * built — not through each sample's own rotation. That difference is the whole
 * shape of the line:
 *
 *  • Per-sample rotation gives the GROUND TRACK: where the satellite passes over
 *    the turning Earth. Over one orbit the planet turns under it, so the track
 *    never closes. For a geostationary satellite the ground track collapses to a
 *    POINT (it hangs over one spot), so its "ring" had no length at all and the
 *    whole GEO fleet drew nothing. Medium orbits (GPS, Galileo) smeared through
 *    half a rotation into a shape that reads as anything but an orbit.
 *  • One frozen rotation gives the ORBIT itself, as it is right now: a closed
 *    ring the satellite actually travels, correct at every altitude. GEO becomes
 *    the equatorial belt, MEO a clean inclined circle, LEO a great circle instead
 *    of the old drifting sinusoid.
 *
 * Sample 0 is the satellite's live position (same instant, same rotation as the
 * marker layer propagates), so every dot sits exactly on its own ring. The ring
 * is Earth-fixed at build time while the real orbit plane is inertial, so the
 * planet turning under it (15°/hour) walks the dots off the line — at the 17s
 * orbital shot hold that is 0.07°, well under a pixel, and every cut rebuilds the
 * rings when it loads the group's elements.
 */
export interface OrbitSegment {
  id: string;
  /** [lng, lat, altMeters]. */
  path: [number, number, number][];
}

type Point = [number, number, number];

/**
 * The point where the leg a→b crosses ±180°, as the pair of coordinates that end
 * one segment and open the next. Without it a closed ring loses a whole sample
 * step (4° of longitude, ~70px across a framed GEO belt) at the seam, which on a
 * ring — unlike an open ground track — reads as a chunk bitten out of the line.
 */
function antimeridianSeam(a: Point, b: Point): [Point, Point] {
  const edge = a[0] > 0 ? 180 : -180;
  const bLng = b[0] + (a[0] > 0 ? 360 : -360); // unwrap b onto a's side
  const t = (edge - a[0]) / (bLng - a[0]);
  const lat = a[1] + (b[1] - a[1]) * t;
  const alt = a[2] + (b[2] - a[2]) * t;
  return [
    [edge, lat, alt],
    [-edge, lat, alt],
  ];
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

  // The planet's orientation NOW, held fixed for every sample — see above.
  const gmst = gstime(now);

  const segs: OrbitSegment[] = [];
  let cur: Point[] = [];
  let seg = 0;
  let prev: Point | null = null;

  const flush = () => {
    if (cur.length > 1) segs.push({ id: `${tle.noradId}:${seg++}`, path: cur });
    cur = [];
  };

  for (let i = 0; i <= samples; i++) {
    const t = new Date(now.getTime() + (periodMin * 60000 * i) / samples);
    const pv = propagate(satrec, t);
    if (!pv || typeof pv.position === "boolean" || !pv.position) continue;
    const geo = eciToGeodetic(pv.position, gmst);
    const lng = degreesLong(geo.longitude);
    const lat = degreesLat(geo.latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const point: Point = [lng, lat, geo.height * 1000];
    if (prev !== null && Math.abs(lng - prev[0]) > 180) {
      const [close, open] = antimeridianSeam(prev, point);
      cur.push(close);
      flush();
      cur.push(open);
    }
    cur.push(point);
    prev = point;
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

/**
 * Highest point of any ring, in metres — what the globe needs to push its far
 * clip plane out to so the back of the shell isn't cut away (see globe-depth.ts).
 */
export function maxOrbitAltitude(segs: OrbitSegment[]): number {
  let max = 0;
  for (const s of segs) for (const p of s.path) if (p[2] > max) max = p[2];
  return max;
}

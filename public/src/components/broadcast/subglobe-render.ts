// Pure math + canvas drawing for the SUB-GLOBE locator slide: a true
// orthographic hemisphere centred on the camera anchor, land silhouette +
// graticule + a kind-accent reticle whose ring tightens with zoom. Everything
// here is deterministic in its inputs (no Date.now, no fetch) so the panel's
// tick loop owns time and the tests can pin the projection exactly.

import type { Point } from "@photonsurge/shared/geo/simplify";

export type LonLat = [number, number];

const RAD = Math.PI / 180;

/** Wrap a longitude to −180..180 (same wrap the Globe motion loop applies). */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The deterministic world-spin longitude the main globe is showing:
 *  anchor + spinSpeed·(now − spinEpoch), exactly Globe.tsx's formula. A zero /
 *  missing epoch means the spin phase is unknowable here — stay on the anchor. */
export function spinLongitude(anchorLng: number, spinDegPerSec: number, spinEpochMs: number, nowMs: number): number {
  if (!spinDegPerSec || !spinEpochMs) return wrapLng(anchorLng);
  return wrapLng(anchorLng + (spinDegPerSec * (nowMs - spinEpochMs)) / 1000);
}

/** Angular radius (deg) of the main view's rough footprint at a GlobeView zoom
 *  — drives the reticle ring so pushing in visibly tightens the circle. */
export function footprintDeg(zoom: number): number {
  return Math.min(60, Math.max(3, 180 / 2 ** zoom));
}

function toVec3([lng, lat]: LonLat): [number, number, number] {
  const φ = lat * RAD;
  const λ = lng * RAD;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

function vec3ToLonLat([x, y, z]: [number, number, number]): LonLat {
  return [Math.atan2(y, x) / RAD, Math.asin(Math.max(-1, Math.min(1, z))) / RAD];
}

/** Great-circle distance between two points, in degrees. */
export function angularDistanceDeg(a: LonLat, b: LonLat): number {
  const va = toVec3(a);
  const vb = toVec3(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  return Math.acos(dot) / RAD;
}

/** Spherical interpolation a→b along the great circle (t 0..1) — the sub-globe's
 *  swing path between camera anchors. Antipodal pairs fall back to `b`. */
export function slerpLonLat(a: LonLat, b: LonLat, t: number): LonLat {
  const va = toVec3(a);
  const vb = toVec3(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const ω = Math.acos(dot);
  if (ω < 1e-6) return b;
  const s = Math.sin(ω);
  if (s < 1e-6) return b; // antipodal — no unique arc
  const ka = Math.sin((1 - t) * ω) / s;
  const kb = Math.sin(t * ω) / s;
  return vec3ToLonLat([
    ka * va[0] + kb * vb[0],
    ka * va[1] + kb * vb[1],
    ka * va[2] + kb * vb[2],
  ]);
}

export interface Projected {
  x: number;
  y: number;
  /** cos of the angular distance to the sub-camera point — ≥ 0 means this
   *  hemisphere; the raw value lets callers fade/skip near the limb. */
  cosc: number;
}

/** Orthographic projection of `p` onto a disc of radius `r` centred on
 *  `center`: x grows east, y grows north (callers flip y for canvas). */
export function projectOrtho(p: LonLat, center: LonLat, r: number): Projected {
  const φ = p[1] * RAD;
  const φ0 = center[1] * RAD;
  const dλ = (p[0] - center[0]) * RAD;
  const cosc = Math.sin(φ0) * Math.sin(φ) + Math.cos(φ0) * Math.cos(φ) * Math.cos(dλ);
  return {
    x: r * Math.cos(φ) * Math.sin(dλ),
    y: r * (Math.cos(φ0) * Math.sin(φ) - Math.sin(φ0) * Math.cos(φ) * Math.cos(dλ)),
    cosc,
  };
}

/** Destination point at angular distance `distDeg` along `bearingDeg`
 *  (0 = north, 90 = east) from `p` — the ground-circle sampler for the
 *  reticle ring, so it lies ON the sphere instead of being a flat overlay. */
export function spherePointAt(p: LonLat, distDeg: number, bearingDeg: number): LonLat {
  const φ1 = p[1] * RAD;
  const λ1 = p[0] * RAD;
  const δ = distDeg * RAD;
  const θ = bearingDeg * RAD;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * sinφ2);
  return [λ2 / RAD, φ2 / RAD];
}

/** "20.1°N · 149.9°W" — the panel's live coordinate readout. */
export function formatLonLat(lng: number, lat: number): string {
  const w = wrapLng(lng);
  return `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"} · ${Math.abs(w).toFixed(1)}°${w < 0 ? "W" : "E"}`;
}

export interface SubGlobeCamera {
  lng: number;
  lat: number;
  zoom: number;
}

/** Fixed night-nav palette — deliberately theme-independent so the little
 *  planet reads the same on every channel; only the reticle takes the on-air
 *  kind's accent. */
const OCEAN_IN = "rgba(16,28,48,0.95)";
const OCEAN_OUT = "rgba(7,13,24,0.95)";
const LAND_FILL = "rgba(84,116,152,0.85)";
const LAND_EDGE = "rgba(165,192,220,0.35)";
const GRATICULE = "rgba(130,152,178,0.16)";
const LIMB = "rgba(150,176,206,0.45)";

/** Exact horizon crossing on the edge a→b (cosc straddles 0): dot(v, view) is
 *  linear along the 3D chord and normalisation preserves its sign, so the
 *  zero crossing is found by linear interpolation, then projected (landing on
 *  the limb by construction). */
function horizonCrossing(
  a: LonLat,
  coscA: number,
  b: LonLat,
  coscB: number,
  center: LonLat,
  r: number,
): Projected {
  const va = toVec3(a);
  const vb = toVec3(b);
  const f = coscA / (coscA - coscB);
  const v: [number, number, number] = [
    va[0] + f * (vb[0] - va[0]),
    va[1] + f * (vb[1] - va[1]),
    va[2] + f * (vb[2] - va[2]),
  ];
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return projectOrtho(vec3ToLonLat([v[0] / len, v[1] / len, v[2] / len]), center, r);
}

/**
 * Draw the whole sub-globe frame. `size` is the square backing-store size in
 * device px; `land` is the pre-simplified outer-ring list (subglobe-land).
 * Rings are clipped at the horizon: hidden stretches are replaced by arcs
 * along the limb (an earlier clamp-to-limb shortcut swept giant false wedges
 * across the disc whenever a continent sat mostly behind the planet).
 *
 * `tiltDeg` tips the viewpoint that many degrees SOUTH of the camera point,
 * so the marked location renders that far up from the disc centre; `panDeg`
 * tips it WEST, so the mark renders to the right. Coordinates stay true —
 * only the perspective shifts. Used because the on-air widget sinks the disc
 * past the stage edge/corner: without the offsets the reticle would hug the
 * clipped bottom.
 */
export function drawSubGlobe(
  g: CanvasRenderingContext2D,
  size: number,
  cam: SubGlobeCamera,
  land: readonly Point[][],
  accent: string,
  tiltDeg = 0,
  panDeg = 0,
): void {
  const c = size / 2;
  const r = c - size * 0.03;
  const center: LonLat = [cam.lng - panDeg, Math.max(-90, Math.min(90, cam.lat - tiltDeg))];
  // The camera point's on-disc position under the tilted viewpoint — the
  // reticle anchors here (disc centre when tiltDeg is 0).
  const mark = projectOrtho([cam.lng, cam.lat], center, r);
  const mx = c + mark.x;
  const my = c - mark.y;
  g.clearRect(0, 0, size, size);

  // Ocean disc — a soft radial falloff so the sphere reads as lit, not flat.
  const fill = g.createRadialGradient(c - r * 0.25, c - r * 0.3, r * 0.1, c, c, r);
  fill.addColorStop(0, OCEAN_IN);
  fill.addColorStop(1, OCEAN_OUT);
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();

  // Everything on the sphere clips to the disc.
  g.save();
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.clip();

  // Land silhouettes, horizon-clipped. Each ring is walked from a visible
  // vertex; when an edge crosses the horizon the exact crossing is emitted,
  // and each hidden stretch is bridged by the SHORTER arc along the limb —
  // the correct silhouette for every coastline this locator will meet.
  const angleOf = (p: Projected) => Math.atan2(-p.y, p.x); // canvas-coords angle
  g.beginPath();
  for (const ring of land) {
    // Treat the ring cyclically (drop the GeoJSON closing duplicate).
    const last = ring.length - 1;
    const n =
      ring.length > 1 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
        ? last
        : ring.length;
    if (n < 3) continue;
    const proj: Projected[] = new Array(n);
    let firstVis = -1;
    for (let i = 0; i < n; i++) {
      proj[i] = projectOrtho(ring[i] as LonLat, center, r);
      if (firstVis < 0 && proj[i].cosc >= 0) firstVis = i;
    }
    if (firstVis < 0) continue; // fully behind the planet
    const start = proj[firstVis];
    g.moveTo(c + start.x, c - start.y);
    let exitAngle = 0;
    for (let k = 0; k < n; k++) {
      const i = (firstVis + k) % n;
      const j = (firstVis + k + 1) % n;
      const a = proj[i];
      const b = proj[j];
      const aVis = a.cosc >= 0;
      const bVis = b.cosc >= 0;
      if (aVis && bVis) {
        g.lineTo(c + b.x, c - b.y);
      } else if (aVis && !bVis) {
        const x = horizonCrossing(ring[i] as LonLat, a.cosc, ring[j] as LonLat, b.cosc, center, r);
        g.lineTo(c + x.x, c - x.y);
        exitAngle = angleOf(x);
      } else if (!aVis && bVis) {
        const x = horizonCrossing(ring[i] as LonLat, a.cosc, ring[j] as LonLat, b.cosc, center, r);
        // Bridge the hidden stretch along the limb, short way round.
        const entryAngle = angleOf(x);
        let sweep = entryAngle - exitAngle;
        while (sweep > Math.PI) sweep -= 2 * Math.PI;
        while (sweep < -Math.PI) sweep += 2 * Math.PI;
        g.arc(c, c, r, exitAngle, entryAngle, sweep < 0);
        g.lineTo(c + b.x, c - b.y);
      }
      // both hidden → nothing; the limb arc above already spans it.
    }
    g.closePath();
  }
  g.fillStyle = LAND_FILL;
  g.fill();
  g.strokeStyle = LAND_EDGE;
  g.lineWidth = size / 480;
  g.stroke();

  // Graticule — 30° mesh, segments broken at the horizon.
  g.strokeStyle = GRATICULE;
  g.lineWidth = size / 600;
  const stroke = (points: LonLat[]) => {
    g.beginPath();
    let pen = false;
    for (const pt of points) {
      const p = projectOrtho(pt, center, r);
      if (p.cosc < 0.01) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(c + p.x, c - p.y);
      else g.moveTo(c + p.x, c - p.y);
      pen = true;
    }
    g.stroke();
  };
  for (let lat = -60; lat <= 60; lat += 30) {
    const line: LonLat[] = [];
    for (let lng = -180; lng <= 180; lng += 3) line.push([lng, lat]);
    stroke(line);
  }
  for (let lng = -180; lng < 180; lng += 30) {
    const line: LonLat[] = [];
    for (let lat = -90; lat <= 90; lat += 3) line.push([lng, lat]);
    stroke(line);
  }
  g.restore();

  // Limb.
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.strokeStyle = LIMB;
  g.lineWidth = size / 360;
  g.stroke();

  // Reticle — anchored on the camera point's projected position (disc centre
  // only when untilted). The footprint ring is a TRUE ground circle: sampled
  // on the sphere around the camera point and projected point-by-point, so
  // under the tilted perspective it foreshortens into the correct ellipse
  // hugging the surface instead of reading as a flat pasted-on circle. It
  // still tightens as the shot pushes in.
  const fp = footprintDeg(cam.zoom);
  const target: LonLat = [cam.lng, cam.lat];
  g.save();
  g.shadowColor = accent;
  g.shadowBlur = size / 60;
  g.strokeStyle = accent;
  g.lineWidth = size / 280;
  g.beginPath();
  let ringPen = false;
  for (let i = 0; i <= 48; i++) {
    const q = projectOrtho(spherePointAt(target, fp, (i % 48) * 7.5), center, r);
    if (q.cosc < 0.01) {
      ringPen = false; // ring slice behind the horizon — break the stroke
      continue;
    }
    if (ringPen) g.lineTo(c + q.x, c - q.y);
    else g.moveTo(c + q.x, c - q.y);
    ringPen = true;
  }
  g.stroke();
  // Four compass ticks just outside the ring — walked on the sphere along
  // their bearings, so they stay radial under the tilt (lengths set in px).
  const tickDeg = ((size / 36) / r) * (180 / Math.PI);
  g.beginPath();
  for (let bearing = 0; bearing < 360; bearing += 90) {
    const t0 = projectOrtho(spherePointAt(target, fp + tickDeg * 0.4, bearing), center, r);
    const t1 = projectOrtho(spherePointAt(target, fp + tickDeg, bearing), center, r);
    if (t0.cosc < 0 || t1.cosc < 0) continue;
    g.moveTo(c + t0.x, c - t0.y);
    g.lineTo(c + t1.x, c - t1.y);
  }
  g.stroke();
  g.fillStyle = accent;
  g.beginPath();
  g.arc(mx, my, size / 110, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

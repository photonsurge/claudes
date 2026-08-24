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

/**
 * Draw the whole sub-globe frame. `size` is the square backing-store size in
 * device px; `land` is the pre-simplified outer-ring list (subglobe-land).
 * Far-side ring vertices are clamped to the limb along their azimuth — the
 * standard cheap fill trick, invisible at locator size.
 *
 * `tiltDeg` tips the viewpoint that many degrees SOUTH of the camera point,
 * so the marked location renders that far up from the disc centre (its
 * coordinates stay true — only the perspective shifts). Used because the
 * on-air widget sinks the disc past the stage edge: without the tilt the
 * reticle would hug the clipped bottom.
 */
export function drawSubGlobe(
  g: CanvasRenderingContext2D,
  size: number,
  cam: SubGlobeCamera,
  land: readonly Point[][],
  accent: string,
  tiltDeg = 0,
): void {
  const c = size / 2;
  const r = c - size * 0.03;
  const center: LonLat = [cam.lng, Math.max(-90, Math.min(90, cam.lat - tiltDeg))];
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

  // Land silhouettes.
  g.beginPath();
  for (const ring of land) {
    let started = false;
    let visible = 0;
    const path: Array<[number, number]> = [];
    for (const pt of ring) {
      const p = projectOrtho(pt as LonLat, center, r);
      let { x, y } = p;
      if (p.cosc < 0) {
        // Far side — pin to the limb along this vertex's azimuth.
        const len = Math.hypot(x, y);
        if (len < 1e-9) continue;
        x = (x / len) * r;
        y = (y / len) * r;
      } else {
        visible++;
      }
      path.push([c + x, c - y]);
    }
    if (!visible) continue;
    for (const [x, y] of path) {
      if (!started) {
        g.moveTo(x, y);
        started = true;
      } else {
        g.lineTo(x, y);
      }
    }
    if (started) g.closePath();
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
  // only when untilted); the accent ring is the main view's rough footprint,
  // so it tightens as the shot pushes in. (A footprint circle around an
  // off-centre point isn't exactly circular in orthographic projection — at
  // locator size and modest tilts the difference is invisible.)
  const ringR = r * Math.sin(footprintDeg(cam.zoom) * RAD);
  g.save();
  g.shadowColor = accent;
  g.shadowBlur = size / 60;
  g.strokeStyle = accent;
  g.lineWidth = size / 280;
  g.beginPath();
  g.arc(mx, my, ringR, 0, Math.PI * 2);
  g.stroke();
  // Four compass ticks just outside the ring.
  const tick = size / 36;
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    g.moveTo(mx + Math.cos(a) * (ringR + tick * 0.4), my + Math.sin(a) * (ringR + tick * 0.4));
    g.lineTo(mx + Math.cos(a) * (ringR + tick), my + Math.sin(a) * (ringR + tick));
  }
  g.stroke();
  g.fillStyle = accent;
  g.beginPath();
  g.arc(mx, my, size / 110, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

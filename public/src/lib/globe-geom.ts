/**
 * PURE screen-geometry helpers for overlays that must hug the globe's on-screen
 * disc (the atmosphere rim glow + pedestal ring). No GL, no DOM — the caller
 * supplies a `project([lng,lat]) → [x,y]` from deck's live viewport and these
 * turn it into the disc's pixel centre + radius.
 *
 * Key trick: every point exactly 90° of great-circle arc from the sub-camera
 * point lies on the globe's silhouette (the limb). Projecting a ring of such
 * points and averaging gives the on-screen disc centre + radius robustly, with
 * no dependency on deck's internal globe-projection constants.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * The point exactly 90° of great-circle arc from [lng, lat] along `bearingDeg`.
 * With angular distance δ = 90° the destination-point formulae collapse to the
 * closed forms below (cos δ = 0, sin δ = 1). Such points trace the globe's limb.
 */
export function limbPoint(lng: number, lat: number, bearingDeg: number): [number, number] {
  const phi1 = lat * DEG;
  const lam1 = lng * DEG;
  const theta = bearingDeg * DEG;
  const phi2 = Math.asin(Math.cos(phi1) * Math.cos(theta));
  const lam2 = lam1 + Math.atan2(Math.sin(theta) * Math.cos(phi1), -Math.sin(phi1) * Math.sin(phi2));
  return [wrapLng(lam2 * RAD), phi2 * RAD];
}

export interface Disc {
  /** Disc centre in CSS pixels. */
  cx: number;
  cy: number;
  /** Disc radius in CSS pixels. */
  r: number;
}

/**
 * The globe's on-screen disc from a viewport `project` fn and the current
 * sub-camera point. Samples `samples` limb points around the silhouette,
 * projects them, and returns their centroid + mean radius. Returns null if the
 * projection yields non-finite pixels (viewport not ready).
 */
export function discFromProject(
  project: (coord: [number, number]) => number[],
  lng: number,
  lat: number,
  samples = 12,
): Disc | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < samples; i++) {
    const [pl, pa] = limbPoint(lng, lat, (360 / samples) * i);
    const p = project([pl, pa]);
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    xs.push(p[0]);
    ys.push(p[1]);
  }
  const cx = xs.reduce((a, b) => a + b, 0) / samples;
  const cy = ys.reduce((a, b) => a + b, 0) / samples;
  let sr = 0;
  for (let i = 0; i < samples; i++) sr += Math.hypot(xs[i] - cx, ys[i] - cy);
  const r = sr / samples;
  if (!Number.isFinite(r) || r <= 0) return null;
  return { cx, cy, r };
}

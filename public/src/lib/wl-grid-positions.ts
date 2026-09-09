/// <reference path="../types/icomesh.d.ts" />
/**
 * WeatherLayers' GridLayer (wind barbs, arrows, values) places its glyphs on
 * an icosphere whose order follows the zoom, keeps the points within the
 * viewport's radius, and samples the raster at each. In 2026.5 the icosphere
 * and its KDBush index are meant to be cached per order — two module-level
 * Maps are read — but nothing ever writes them, so every camera tick rebuilt
 * up to 163 842 points and re-sorted the index: ~4 s of a minute's main thread
 * in barbs mode on the profiler (docs/watch-perf-plan.md, round 25).
 *
 * This is the same construction with the caches that were intended: the same
 * icomesh / kdbush / geokdbush / geodesy-fn calls with the same arguments in
 * the same order, so the positions — and their order, nearest first — are the
 * ones WeatherLayers computes. Globe viewports only; the Mercator branch is
 * left to WeatherLayers (wl-grid-patch.ts falls back to it).
 */
import icomesh from "icomesh";
import KDBush from "kdbush";
import { around } from "geokdbush";
import { distance } from "geodesy-fn";

export type LngLat = [number, number];

/** The slice of a deck GlobeViewport WeatherLayers reads. */
export interface GlobeViewportLike {
  resolution?: number;
  scale: number;
  longitude: number;
  latitude: number;
  width: number;
  height: number;
  unproject(px: number[]): number[];
}

/** WeatherLayers' sphere radius for its viewport metrics (metres). */
export const WL_EARTH_RADIUS_M = 6370972;
const MAX_ORDER = 7;

const pointsByOrder = new Map<number, LngLat[]>();
const indexByOrder = new Map<number, KDBush>();

/** Icosphere order for a zoom and WeatherLayers' `density + 3` offset. */
export function icosphereOrder(zoom: number, t: number): number {
  return Math.min(Math.max(Math.floor(zoom + t + 1) - 2, 0), MAX_ORDER);
}

/** The order's grid points as [lng, lat] (poles last), built once per order. */
export function icospherePoints(order: number): LngLat[] {
  let pts = pointsByOrder.get(order);
  if (!pts) {
    const { uv } = icomesh(order, true);
    pts = [];
    if (uv) {
      for (let i = 0; i < uv.length; i += 2) {
        const u = uv[i];
        const v = uv[i + 1];
        if (u === 0) continue;
        if (v <= 0 || v >= 1) continue;
        pts.push([360 * u - 180, 180 * v - 90]);
      }
    }
    pts.push([0, -90]);
    pts.push([0, 90]);
    pointsByOrder.set(order, pts);
  }
  return pts;
}

/** The order's KDBush over its points (Float32 coords, default node size), built once. */
export function icosphereIndex(order: number): KDBush {
  let index = indexByOrder.get(order);
  if (!index) {
    const pts = icospherePoints(order);
    index = new KDBush(pts.length, undefined, Float32Array);
    for (const p of pts) index.add(p[0], p[1]);
    index.finish();
    indexByOrder.set(order, index);
  }
  return index;
}

/** WeatherLayers' viewport radius: the farthest of a few edge/mid pixels from the centre, metres. */
export function viewportGlobeRadiusM(v: GlobeViewportLike): number {
  const c: LngLat = [v.longitude, v.latitude];
  const d = (px: number[]) => distance(c, v.unproject(px), WL_EARTH_RADIUS_M);
  const { width: w, height: h } = v;
  return Math.max(
    d([w / 2, 0]),
    d([0, h / 2]),
    ...(w > h
      ? [d([w / 2 - (h / 4) * 1, h / 2]), d([w / 2 - (h / 2) * 1, h / 2]), d([w / 2 - (h / 4) * 3, h / 2]), d([w / 2 - h, h / 2])]
      : [d([w / 2, h / 2 - (w / 4) * 1]), d([w / 2, h / 2 - (w / 2) * 1]), d([w / 2, h / 2 - (w / 4) * 3]), d([w / 2, h / 2 - w])]),
  );
}

/** The grid positions for a globe viewport at WeatherLayers' `t` (= density + 3), nearest first. */
export function globeGridPositions(v: GlobeViewportLike, t: number): LngLat[] {
  const order = icosphereOrder(Math.log2(v.scale), t);
  const radiusKm = viewportGlobeRadiusM(v) / 1e3;
  const pts = icospherePoints(order);
  return around(icosphereIndex(order), v.longitude, v.latitude, undefined, radiusKm).map((i) => pts[i]);
}

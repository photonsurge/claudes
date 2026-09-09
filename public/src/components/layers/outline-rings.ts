/**
 * Polygon outlines as PathLayer data, and polygon parts as SolidPolygonLayer
 * data — so glow rings and fills never go through GeoJsonLayer.
 *
 * WHY: deck's GeoJsonLayer ALWAYS builds a `polygons-fill` SolidPolygonLayer
 * sublayer for polygon features (CompositeLayer.shouldRenderSubLayer only asks
 * "is there data?"), and that sublayer runs earcut over every polygon in its
 * updateState even when `filled: false` — only its draw() is a no-op. A
 * stroke-only GeoJsonLayer therefore pays a full tessellation for nothing, and
 * four glow rings over the same shapes pay it four times: the 822 ms
 * main-thread stall the profiler caught at a country spotlight cut (the 4 MB
 * country outline, earcut ×4). GeoJsonLayer's own stroke sublayer is just a
 * PathLayer over the polygon rings, so feeding a PathLayer these rings draws
 * the identical outline with no fill sublayer and no earcut.
 *
 * Both helpers memoise on identity (the features array / the feature), because
 * deck treats a new `data` reference as "re-tessellate everything": a stable
 * input reference keeps a stable `data` reference across rebuilds.
 */

export type Position = number[];
/** One polygon: outer ring first, then holes (GeoJSON order). */
export type PolygonRings = Position[][];

export interface RingFeature {
  geometry?: { type: string; coordinates: unknown } | null;
}

/** One PathLayer datum: a closed polygon ring plus the feature it came from. */
export interface OutlineRing<F> {
  path: Position[];
  feature: F;
}

/** Shared empty ring list — hand deck this (not a fresh `[]`) when there is nothing to draw. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const NO_RINGS: OutlineRing<any>[] = [];
/** Shared empty polygon-part list, same reasoning. */
export const NO_PARTS: PolygonRings[] = [];

const ringCache = new WeakMap<object, OutlineRing<unknown>[]>();
const partCache = new WeakMap<object, PolygonRings[]>();

function pushRings<F>(out: OutlineRing<F>[], feature: F, polygon: PolygonRings): void {
  if (!Array.isArray(polygon)) return;
  for (const ring of polygon) {
    if (Array.isArray(ring) && ring.length >= 2) out.push({ path: ring, feature });
  }
}

/**
 * Every ring (outer + holes) of every Polygon / MultiPolygon in `features`, in
 * feature order — exactly the outlines GeoJsonLayer would stroke. Non-polygon
 * geometries contribute nothing. Memoised per `features` array identity.
 */
export function outlineRings<F extends RingFeature>(features: F[]): OutlineRing<F>[] {
  if (!features.length) return NO_RINGS as OutlineRing<F>[];
  const hit = ringCache.get(features);
  if (hit) return hit as OutlineRing<F>[];
  const out: OutlineRing<F>[] = [];
  for (const feature of features) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "Polygon") pushRings(out, feature, g.coordinates as PolygonRings);
    else if (g.type === "MultiPolygon") {
      const polys = g.coordinates as PolygonRings[];
      if (Array.isArray(polys)) for (const poly of polys) pushRings(out, feature, poly);
    }
  }
  ringCache.set(features, out);
  return out;
}

/**
 * A feature's polygon parts as SolidPolygonLayer data (`getPolygon: d => d`):
 * a Polygon is one part, a MultiPolygon one per member. Memoised per feature.
 */
export function polygonParts<F extends RingFeature>(feature: F): PolygonRings[] {
  const hit = partCache.get(feature);
  if (hit) return hit;
  const g = feature.geometry;
  let parts: PolygonRings[] = NO_PARTS;
  if (g?.type === "Polygon" && Array.isArray(g.coordinates)) parts = [g.coordinates as PolygonRings];
  else if (g?.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
    parts = (g.coordinates as PolygonRings[]).filter((p) => Array.isArray(p));
  }
  partCache.set(feature, parts);
  return parts;
}

/**
 * The feature behind a deck pick: a ring datum unwraps to the feature it
 * outlines; anything else (a GeoJson feature, a quake, a volcano) is returned
 * as is. Lets the globe's hover/click handlers stay layer-agnostic.
 */
export function pickedFeature<T = unknown>(object: unknown): T | null {
  if (!object || typeof object !== "object") return null;
  const o = object as { path?: unknown; feature?: unknown };
  if (Array.isArray(o.path) && o.feature && typeof o.feature === "object") return o.feature as T;
  return object as T;
}

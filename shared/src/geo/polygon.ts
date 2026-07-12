// geo/polygon.ts
// Dependency-free polygon AREA + bounding-box helpers over the plain GeoJSON
// geometry the alert model carries (`{ type, coordinates }`, no @types/geojson).
// Sits beside pointInPolygon.ts. Used by the alert diff (area-over-time,
// AREA_CHANGED magnitude) and the satellite-snapshot job (alert bbox → padded
// WMS frame). There is no turf.js in this repo by design — this is the whole
// of the geometry maths the alert-timeline feature needs.

/** Minimal GeoJSON geometry — matches AlertGeometry in db/alert-model.ts. */
export interface GeoLike {
  type: string;
  coordinates: unknown;
}

/** [west, south, east, north]. */
export type Bbox = [number, number, number, number];

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** A single position from a GeoJSON coordinate array is `[lng, lat, ...]`. */
function isPosition(v: unknown): v is [number, number] {
  return Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number";
}

/**
 * Spherical area of one closed ring, km² (absolute value). Uses the standard
 * spherical-excess sum over edges; accurate to well under 1% at alert scales,
 * which is all AREA_CHANGED / the area graph need. Rings need not be explicitly
 * closed — the edge loop wraps.
 */
function ringAreaKm2(ring: [number, number][]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % n];
    sum += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2);
}

/** Extract clean `[lng,lat][]` rings from a raw coordinate array (defensive). */
function toRings(coords: unknown): [number, number][][] {
  if (!Array.isArray(coords)) return [];
  return coords
    .map((ring) => (Array.isArray(ring) ? ring.filter(isPosition) : []))
    .filter((ring) => ring.length > 0);
}

/**
 * Total surface area of a Polygon/MultiPolygon in km² (outer ring minus holes,
 * summed across parts). Point/LineString/unknown → 0. Never throws on malformed
 * geometry — it walks defensively and returns what it can.
 */
export function polygonAreaKm2(geometry: GeoLike | null | undefined): number {
  if (!geometry || !geometry.coordinates) return 0;
  const polys: [number, number][][][] =
    geometry.type === "MultiPolygon"
      ? (Array.isArray(geometry.coordinates) ? geometry.coordinates.map(toRings) : [])
      : geometry.type === "Polygon"
        ? [toRings(geometry.coordinates)]
        : [];
  let total = 0;
  for (const rings of polys) {
    if (!rings.length) continue;
    const outer = ringAreaKm2(rings[0]);
    let holes = 0;
    for (let h = 1; h < rings.length; h++) holes += ringAreaKm2(rings[h]);
    total += Math.max(0, outer - holes);
  }
  return total;
}

/**
 * Axis-aligned bounding box of any geometry (walks every position, Point through
 * MultiPolygon), or null when there are no usable coordinates. Does not attempt
 * antimeridian-aware splitting — matches the rest of the codebase's bbox reads.
 */
export function bboxOf(geometry: GeoLike | null | undefined): Bbox | null {
  if (!geometry || geometry.coordinates == null) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const walk = (node: unknown): void => {
    if (isPosition(node)) {
      const [lng, lat] = node;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    if (Array.isArray(node)) for (const child of node) walk(child);
  };
  walk(geometry.coordinates);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Grow a bbox by `frac` of its span on each side (with a `minDeg` floor so a
 * near-point alert still yields a real frame), clamped to valid lng/lat. Used to
 * give a satellite snapshot some context margin around the warning polygon.
 */
export function padBbox(bbox: Bbox, opts: { frac?: number; minDeg?: number } = {}): Bbox {
  const frac = opts.frac ?? 0.25;
  const minDeg = opts.minDeg ?? 0.5;
  const [w, s, e, n] = bbox;
  const padLng = Math.max((e - w) * frac, minDeg);
  const padLat = Math.max((n - s) * frac, minDeg);
  return [
    Math.max(-180, w - padLng),
    Math.max(-90, s - padLat),
    Math.min(180, e + padLng),
    Math.min(90, n + padLat),
  ];
}

/** Merge two bboxes into their union. */
function mergeBbox(a: Bbox, b: Bbox): Bbox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/**
 * Union bbox across every area geometry of an alert's `info[]`, or null when the
 * alert is geocode-only (no geometry). Shape kept loose (`{ area: { geometry }[]
 * }[]`) so it accepts iAlertInfo without importing the model into geo/.
 */
export function unionBboxOfAlert(
  info: { area?: { geometry?: GeoLike | null }[] }[] | undefined,
): Bbox | null {
  if (!info?.length) return null;
  let acc: Bbox | null = null;
  for (const inf of info) {
    for (const ar of inf.area ?? []) {
      const b = bboxOf(ar.geometry);
      if (b) acc = acc ? mergeBbox(acc, b) : b;
    }
  }
  return acc;
}

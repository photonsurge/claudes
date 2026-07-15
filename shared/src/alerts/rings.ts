/**
 * Ring winding/closure helpers shared by every alert adapter that hands a polygon
 * to Mongo. The 2dsphere index is strict in two ways a raw source often isn't:
 * a ring must be explicitly closed, and a small region's OUTER ring must wind
 * counter-clockwise (a clockwise ring is read as its complement — "bigger than a
 * hemisphere" — and rejected). Holes are the opposite: clockwise.
 *
 * Sources disagree on both, so normalise once here rather than per adapter.
 */

export type Ring = [number, number][];

/** Shoelace signed area of a closed [lng,lat] ring; >0 == counter-clockwise. */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

/** Drop adjacent duplicate vertices and explicitly close the ring. */
export function closeRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const pt of ring) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1]) out.push(pt);
  }
  if (out.length < 3) return out;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
  return out;
}

/**
 * Close `ring` and force its winding: `ccw` true for an outer ring, false for a
 * hole. Returns null when fewer than 3 distinct vertices survive (degenerate).
 */
export function windRing(ring: Ring, ccw: boolean): Ring | null {
  const closed = closeRing(ring);
  if (closed.length < 4) return null; // 3 distinct points + the closing repeat
  const isCcw = signedArea(closed) > 0;
  return isCcw === ccw ? closed : closed.slice().reverse();
}

const isRing = (v: unknown): v is Ring =>
  Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite));

/** Normalise one polygon's rings: outer CCW, every hole CW. Null if no outer ring. */
function windPolygon(rings: unknown): Ring[] | null {
  if (!Array.isArray(rings)) return null;
  const out: Ring[] = [];
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    if (!isRing(r)) continue;
    const wound = windRing(r as Ring, i === 0);
    if (!wound) {
      if (i === 0) return null; // outer ring is degenerate — the polygon is unusable
      continue; // a degenerate hole is simply dropped
    }
    out.push(wound);
  }
  return out.length ? out : null;
}

/**
 * Normalise a GeoJSON Polygon/MultiPolygon so Mongo's 2dsphere accepts it.
 * Point/other types pass through untouched; anything unusable returns null so
 * the caller can fall back rather than persist a polygon Mongo will reject.
 */
export function windGeometry<T extends { type?: string; coordinates?: unknown }>(
  geometry: T | null | undefined,
): T | null {
  if (!geometry?.coordinates || !geometry.type) return null;

  if (geometry.type === "Polygon") {
    const rings = windPolygon(geometry.coordinates);
    return rings ? ({ ...geometry, coordinates: rings } as T) : null;
  }

  if (geometry.type === "MultiPolygon") {
    const parts = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const out = parts.map(windPolygon).filter((p): p is Ring[] => !!p);
    return out.length ? ({ ...geometry, coordinates: out } as T) : null;
  }

  return geometry;
}

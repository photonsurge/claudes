// geo/simplify.ts
// Douglas–Peucker line simplification for GeoJSON rings. Natural Earth admin-0
// boundaries run into the thousands of vertices for large countries; the
// countries seed job uses this to shrink a ring to something small enough to
// store on a Mongo doc and ray-cast per pixel in the area-weather job.

export type Point = [number, number];

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

function douglasPeucker(points: Point[], toleranceDeg: number): Point[] {
  if (points.length <= 2) return points;
  const end = points.length - 1;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < end; i++) {
    const d = perpendicularDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= toleranceDeg) return [points[0], points[end]];
  const left = douglasPeucker(points.slice(0, index + 1), toleranceDeg);
  const right = douglasPeucker(points.slice(index), toleranceDeg);
  return left.slice(0, -1).concat(right);
}

/**
 * Simplify a closed GeoJSON ring (first point === last point) down to the
 * points that matter at `toleranceDeg` — endpoints are preserved exactly, so
 * a closed ring stays closed. Falls back to the original ring if
 * simplification would collapse it below a valid polygon (4 points: a
 * triangle plus its closing point).
 */
export function simplifyRing(ring: Point[], toleranceDeg: number): Point[] {
  if (ring.length <= 4) return ring;
  const simplified = douglasPeucker(ring, toleranceDeg);
  return simplified.length >= 4 ? simplified : ring;
}

/**
 * Simplify every ring of a Polygon/MultiPolygon to `toleranceDeg`; Point and
 * other geometry types pass through untouched. Returns a NEW geometry (does not
 * mutate the input). Used to shrink the alert map-overlay feed: whole-ocean
 * WMO/marine warnings arrive as 40,000-vertex rings that the globe draws as a
 * blob — keeping full precision made the cached `/api/alerts` payload hundreds of
 * MB, and every poll re-parsed it into a fresh copy until public OOM'd. A coarse
 * tolerance (~0.05° ≈ 5 km) is invisible at globe zoom and cuts vertices ~100×.
 */
export function simplifyGeometry<G extends { type?: string; coordinates?: unknown } | null | undefined>(
  geometry: G,
  toleranceDeg: number,
): G {
  if (!geometry || geometry.coordinates == null) return geometry;
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as Point[][];
    return { ...geometry, coordinates: rings.map((r) => simplifyRing(r, toleranceDeg)) };
  }
  if (geometry.type === "MultiPolygon") {
    const polys = geometry.coordinates as Point[][][];
    return { ...geometry, coordinates: polys.map((p) => p.map((r) => simplifyRing(r, toleranceDeg))) };
  }
  return geometry;
}

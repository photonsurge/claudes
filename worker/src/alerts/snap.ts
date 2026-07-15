import { windGeometry } from "@photonsurge/shared/alerts/rings";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";

/**
 * Round a boundary onto a shared grid.
 *
 * The dissolve's whole job is to fuse areas that share a border, and that makes
 * it very picky about HOW you cheapen the geometry first:
 *
 * - Douglas-Peucker (what `simplifyGeometry` does) chooses which points to keep
 *   from each ring's OWN shape. Two neighbours therefore thin their shared border
 *   DIFFERENTLY, it stops matching, and they stop fusing. That's the same
 *   mechanism that leaves white seams between provinces in the raw overlay — and
 *   it's worse here: near-coincident edges are exactly what polygon-clipping
 *   throws "Loop is not valid" on, so it costs precision AND creates errors.
 *
 * - Snapping to a grid is a function of the COORDINATE, not the ring. Both sides
 *   of a shared border round to identical points, so the border survives intact
 *   and near-coincident edges become EXACTLY coincident — which is the case the
 *   clipper handles well.
 *
 * The saving comes from collapsing the runs of sub-grid-sized steps that real
 * coastline data is full of; the shape's topology is untouched.
 */

/** Round to the nearest multiple of `grid`, avoiding float drift like 0.30000000000000004. */
const quantize = (v: number, grid: number): number => {
  const inv = 1 / grid;
  return Math.round(v * inv) / inv;
};

/** Snap a ring and drop the steps that collapse onto each other. */
function snapRing(ring: number[][], grid: number): number[][] | null {
  const out: number[][] = [];
  for (const p of ring) {
    const q = [quantize(p[0], grid), quantize(p[1], grid)];
    const prev = out[out.length - 1];
    // Consecutive points landing on the same grid cell are one point now.
    if (prev && prev[0] === q[0] && prev[1] === q[1]) continue;
    out.push(q);
  }
  // Re-close: the first point may have moved.
  if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) {
    out.push([out[0][0], out[0][1]]);
  }
  // Fewer than 3 distinct points is no longer an area — the caller drops it.
  return out.length >= 4 ? out : null;
}

function snapPolygon(rings: number[][][], grid: number): number[][][] | null {
  const out: number[][][] = [];
  for (let i = 0; i < rings.length; i++) {
    const r = snapRing(rings[i], grid);
    // A collapsed OUTER ring means the whole polygon is sub-grid; a collapsed
    // hole is simply gone.
    if (!r) {
      if (i === 0) return null;
      continue;
    }
    out.push(r);
  }
  return out.length ? out : null;
}

/**
 * Snap a Polygon/MultiPolygon to `grid` degrees. Returns null when nothing
 * survives, so the caller can fall back to the original rather than lose an area
 * that's simply smaller than the grid.
 */
export function snapGeometry(g: AlertGeometry | null | undefined, grid: number): AlertGeometry | null {
  if (!g || !grid || !Array.isArray(g.coordinates)) return null;

  if (g.type === "Polygon") {
    const rings = snapPolygon(g.coordinates as unknown as number[][][], grid);
    return rings ? windGeometry({ ...g, coordinates: rings } as AlertGeometry) : null;
  }
  if (g.type === "MultiPolygon") {
    const parts = (g.coordinates as unknown as number[][][][])
      .map((p) => snapPolygon(p, grid))
      .filter((p): p is number[][][] => !!p);
    return parts.length ? windGeometry({ ...g, coordinates: parts } as AlertGeometry) : null;
  }
  return g; // a Point has no rings to snap
}

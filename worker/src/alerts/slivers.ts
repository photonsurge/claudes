import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";

/**
 * Drop the sliver holes a union leaves behind.
 *
 * When two counties' borders don't match to the micron — and real boundary data
 * never does — unioning them leaves a hairline GAP between them. The gap is
 * interior to the fused shape, so it comes back as a hole in the output polygon,
 * and the globe dutifully draws an outline round it. That's what the orange
 * streaks across the middle of Poland and Texas were: not separate warnings, not
 * missing data, just the seams the union failed to close, drawn as if they meant
 * something.
 *
 * They are expensive as well as wrong. Measured on a live rebuild: 7,608 holes
 * across 624 blobs, holding 52,772 vertices — 18% of every vertex we store, on
 * geometry that exists only to draw artifacts.
 *
 * The danger runs the OTHER way, and it governs every choice here: a real void —
 * somewhere with no warning over it, inside a region that has one — is also a
 * hole. Dropping that paints a warning over a place that never had one, which is
 * a lie about the data. Leaving a seam is merely ugly. So every rule below is
 * built to fail toward keeping.
 *
 * Size alone cannot tell them apart, which is the trap this walked into first: a
 * 4°-long, 11m-wide gap has an area of 4e-4 deg², BIGGER than plenty of real
 * enclaves, so an area threshold keeps the very streaks it was meant to remove
 * and has to be cranked up until it starts eating real places. Shape is the
 * honest test — a seam is long and thin, a place is not.
 *
 * The rule is therefore: tiny outright, OR seam-shaped AND under a hard area
 * ceiling. Measured against a live rebuild:
 *
 *     rule                              | hole verts dropped | biggest dropped
 *     ----------------------------------|--------------------|----------------
 *     area < 1e-5                       |        62%         | 1.0e-5
 *     thinness < 0.05 (alone)           |        31%         | 1.4e-1  <- a 40km
 *                                       |                    |    void. Unsafe.
 *     area<1e-5 OR (thin & area<1e-2)   |        64%         | 5.5e-3  <- here
 *
 * Thinness on its own would delete a hole 40km across for the crime of being
 * elongated. With the ceiling, nothing county-scale is ever touched: the biggest
 * hole dropped from a live rebuild was 5.5e-3 deg² and the smallest kept 1.0e-5.
 *
 * Only HOLES are dropped, never an outer ring: a small outer ring is usually a
 * real island (the Greek and Croatian coasts are made of them), and losing a
 * warning off the globe is far worse than drawing a seam.
 */

/**
 * Drop a hole this small outright (~350m across). Nothing real is 350m wide.
 */
export const MIN_HOLE_AREA_DEG2 = 1e-5;

/**
 * ...and drop a hole THINNER than this only if it's also under MAX_SEAM_AREA_DEG2.
 *
 * Area alone cannot identify a seam, which is the trap this walked into first: a
 * 4°-long, 11m-wide gap between two counties has an area of 4e-4 deg² — bigger
 * than plenty of real enclaves — so an area rule keeps the very streaks we're
 * trying to remove. Shape is the honest test. This is the isoperimetric quotient
 * 4·π·area / perimeter²: 1 for a circle, ~0.79 for a square, →0 for a seam.
 * Live holes run p25=0.02, p50=0.07, p99=0.75.
 */
export const MAX_SEAM_THINNESS = 0.05;

/**
 * The hard ceiling: a hole bigger than this is NEVER dropped, however thin.
 *
 * ~11km × 11km. Thinness alone was measured dropping a 1.4e-1 deg² hole — some
 * 40km across — purely for being elongated, and a real void that size is a place
 * with no warning over it. Painting a warning over somewhere that hasn't got one
 * is a lie about the data; leaving a seam is only ugly. So the shape test is
 * allowed to act on small holes only, and anything county-scale survives no
 * matter what shape it is.
 *
 * With this ceiling the biggest hole ever dropped from a live rebuild was
 * 5.5e-3 deg², and the smallest kept was 1.0e-5.
 */
export const MAX_SEAM_AREA_DEG2 = 1e-2;

/**
 * Shoelace area of a ring in deg², sign discarded.
 *
 * Planar, not geodesic, on purpose: the comparison is against a threshold chosen
 * from this same measure, and the whole question is "is this a micron-wide seam
 * or a real place" — a cos(lat) correction cannot move a 33m sliver anywhere near
 * a 14km enclave.
 */
export function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

/** Ring perimeter in degrees. */
function perimeter(ring: number[][]): number {
  let p = 0;
  for (let i = 1; i < ring.length; i++) {
    p += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  }
  return p;
}

/**
 * Isoperimetric quotient — how round a ring is. 1 = circle, ~0.79 = square,
 * →0 = a seam. This is what tells a gap from a place; area can't.
 */
export function thinness(ring: number[][]): number {
  const p = perimeter(ring);
  return p === 0 ? 0 : (4 * Math.PI * ringArea(ring)) / (p * p);
}

/**
 * Is this hole an artifact of the union rather than a real void?
 *
 * Tiny outright, or seam-shaped AND small enough that it cannot be a place.
 * Deliberately asymmetric: keeping a seam costs a stray line on the globe;
 * dropping a real void covers somewhere in a warning it never had.
 */
export function isSeam(ring: number[][], minArea: number): boolean {
  const a = ringArea(ring);
  if (a < minArea) return true;
  return a < MAX_SEAM_AREA_DEG2 && thinness(ring) < MAX_SEAM_THINNESS;
}

/** Keep the outer ring; keep every hole that could be a real place. */
function cleanPolygon(rings: number[][][], minArea: number): number[][][] {
  const out: number[][][] = [rings[0]];
  for (let i = 1; i < rings.length; i++) {
    if (!isSeam(rings[i], minArea)) out.push(rings[i]);
  }
  return out;
}

export interface SliverStats {
  /** Holes removed. */
  dropped: number;
  /** Vertices removed with them — the point of the exercise. */
  vertices: number;
}

/**
 * Strip sliver holes from a Polygon/MultiPolygon.
 *
 * Returns the geometry unchanged (by identity) when there's nothing to drop, so
 * a caller can cheaply tell whether anything happened, and so the common case
 * allocates nothing.
 */
export function dropSliverHoles(
  g: AlertGeometry | null | undefined,
  minArea: number = MIN_HOLE_AREA_DEG2,
  stats?: SliverStats,
): AlertGeometry | null | undefined {
  if (!g?.coordinates || minArea <= 0) return g;

  const count = (before: number[][][], after: number[][][]) => {
    if (!stats) return;
    for (let i = 1; i < before.length; i++) {
      if (!after.includes(before[i])) {
        stats.dropped++;
        stats.vertices += before[i].length;
      }
    }
  };

  if (g.type === "Polygon") {
    const rings = g.coordinates as unknown as number[][][];
    if (rings.length < 2) return g; // no holes to consider
    const cleaned = cleanPolygon(rings, minArea);
    if (cleaned.length === rings.length) return g;
    count(rings, cleaned);
    return { ...g, coordinates: cleaned } as AlertGeometry;
  }

  if (g.type === "MultiPolygon") {
    const polys = g.coordinates as unknown as number[][][][];
    let changed = false;
    const cleaned = polys.map((p) => {
      if (p.length < 2) return p;
      const c = cleanPolygon(p, minArea);
      if (c.length !== p.length) {
        changed = true;
        count(p, c);
      }
      return c;
    });
    return changed ? ({ ...g, coordinates: cleaned } as AlertGeometry) : g;
  }

  return g; // a Point has no rings
}

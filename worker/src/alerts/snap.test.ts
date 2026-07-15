import { snapGeometry } from "./snap";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";

/**
 * Grid-snapping: the topology-safe way to cheapen a boundary, kept for reference
 * after being measured WORSE than Douglas-Peucker on live data (it introduces
 * its own degenerate rings — blobs 68 -> 81, failures 33 -> 41 on the worst
 * bucket). The property that made it worth trying is the one pinned first below:
 * unlike DP, it's a function of the COORDINATE, so two neighbours' shared border
 * survives intact instead of drifting apart.
 */

const poly = (ring: number[][]): AlertGeometry => ({ type: "Polygon", coordinates: [ring] });

describe("snapGeometry", () => {
  it("rounds a shared border identically for both neighbours", () => {
    // The whole point. A and B meet along x≈1, described slightly differently by
    // each source — after snapping, both must read EXACTLY the same edge, or the
    // dissolve can't fuse them.
    const a = poly([[0, 0], [1.0001, 0], [1.0003, 1], [0, 1], [0, 0]]);
    const b = poly([[0.9998, 0], [2, 0], [2, 1], [1.0002, 1], [0.9998, 0]]);

    const sa = snapGeometry(a, 0.001)!.coordinates as unknown as number[][][];
    const sb = snapGeometry(b, 0.001)!.coordinates as unknown as number[][][];

    // The POINTS along the shared edge must match, not the raw count — a ring
    // repeats its first vertex to close, so counting would compare the wrong thing.
    const edge = (rings: number[][][]) =>
      [...new Set(rings[0].filter((p) => p[0] === 1).map((p) => p.join(",")))].sort();

    expect(edge(sa).length).toBeGreaterThan(0);
    expect(edge(sb)).toEqual(edge(sa));
  });

  it("collapses the sub-grid wobble real coastlines are full of", () => {
    const ring: number[][] = [];
    for (let i = 0; i <= 100; i++) ring.push([i * 0.0001, (i % 2) * 0.00002]);
    ring.push([0.01, 1], [0, 1], [0, 0]);

    const out = snapGeometry(poly(ring), 0.001)!.coordinates as unknown as number[][][];

    expect(out[0].length).toBeLessThan(ring.length / 4);
  });

  it("never moves a point further than the grid", () => {
    const out = snapGeometry(poly([[0, 0], [1.0004, 0], [1, 1], [0, 1], [0, 0]]), 0.001)!;
    const pts = (out.coordinates as unknown as number[][][])[0];

    for (const p of pts) {
      expect(Math.abs(p[0] - Math.round(p[0] * 1000) / 1000)).toBeLessThan(1e-9);
    }
  });

  it("keeps the ring closed after the first point moves", () => {
    const out = snapGeometry(poly([[0.0004, 0.0004], [1, 0], [1, 1], [0.0004, 0.0004]]), 0.001)!;
    const ring = (out.coordinates as unknown as number[][][])[0];

    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("returns null when an area is smaller than the grid, so the caller can keep the original", () => {
    // Vanishing a real warning off the globe would be worse than a coarse one.
    expect(snapGeometry(poly([[0, 0], [0.0001, 0], [0.0001, 0.0001], [0, 0]]), 0.01)).toBeNull();
  });

  it("drops a hole that collapses but keeps its polygon", () => {
    const holed: AlertGeometry = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
        [[0.5, 0.5], [0.5001, 0.5], [0.5001, 0.5001], [0.5, 0.5]],
      ],
    };

    const out = snapGeometry(holed, 0.01)!;

    expect((out.coordinates as unknown as number[][][])).toHaveLength(1);
  });

  it("snaps every part of a MultiPolygon", () => {
    const multi: AlertGeometry = {
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [1.0004, 0], [1, 1], [0, 1], [0, 0]]],
        [[[5, 5], [6.0004, 5], [6, 6], [5, 6], [5, 5]]],
      ],
    };

    const out = snapGeometry(multi, 0.001)!;
    const parts = out.coordinates as unknown as number[][][][];

    expect(parts).toHaveLength(2);
    expect(parts[1][0].some((p) => p[0] === 6)).toBe(true);
  });

  it("leaves a Point alone and refuses nonsense", () => {
    const pt = { type: "Point", coordinates: [1, 2] } as AlertGeometry;
    expect(snapGeometry(pt, 0.001)).toBe(pt);
    expect(snapGeometry(null, 0.001)).toBeNull();
    expect(snapGeometry(poly([[0, 0], [1, 0], [1, 1], [0, 0]]), 0)).toBeNull();
  });

  it("does not leave float dust on the grid", () => {
    const out = snapGeometry(poly([[0.3000004, 0.1000007], [1, 0], [1, 1], [0.3000004, 0.1000007]]), 0.0001)!;
    const ring = (out.coordinates as unknown as number[][][])[0];

    expect(ring[0][0]).toBe(0.3);
  });
});

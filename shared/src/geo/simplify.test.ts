import { simplifyRing, type Point } from "./simplify";

describe("simplifyRing", () => {
  it("collapses near-collinear points on a straight edge", () => {
    const ring: Point[] = [
      [0, 0],
      [1, 0.001],
      [2, -0.001],
      [3, 0],
      [3, 3],
      [0, 3],
      [0, 0],
    ];
    const out = simplifyRing(ring, 0.01);
    expect(out.length).toBeLessThan(ring.length);
    expect(out[0]).toEqual(ring[0]);
    expect(out[out.length - 1]).toEqual(ring[ring.length - 1]);
  });

  it("keeps the ring closed (first point === last point)", () => {
    const ring: Point[] = [
      [0, 0],
      [1, 0.001],
      [2, -0.001],
      [3, 0],
      [3, 3],
      [1.5, 3.001],
      [0, 3],
      [0, 0],
    ];
    const out = simplifyRing(ring, 0.01);
    expect(out[0]).toEqual(out[out.length - 1]);
  });

  it("leaves short rings untouched", () => {
    const ring: Point[] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(simplifyRing(ring, 1)).toEqual(ring);
  });

  it("falls back to the original ring if simplification would collapse it too far", () => {
    const ring: Point[] = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 3], [0, 0]];
    const out = simplifyRing(ring, 1000);
    expect(out).toEqual(ring);
  });

  it("preserves a sharp corner regardless of tolerance", () => {
    const ring: Point[] = [
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const out = simplifyRing(ring, 0.5);
    expect(out).toContainEqual([10, 0]);
    expect(out).toContainEqual([10, 10]);
  });
});

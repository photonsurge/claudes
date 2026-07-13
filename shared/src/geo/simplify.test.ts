import { simplifyRing, simplifyGeometry, type Point } from "./simplify";

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

describe("simplifyGeometry", () => {
  // A dense edge (11 near-collinear points) that Douglas–Peucker should collapse.
  const denseRing: Point[] = Array.from({ length: 11 }, (_, i) => [i, i % 2 ? 0.0005 : -0.0005] as Point)
    .concat([[10, 5], [0, 5], [0, -0.0005]]);

  it("simplifies every ring of a Polygon (fewer vertices, new object)", () => {
    const geom = { type: "Polygon", coordinates: [denseRing] };
    const out = simplifyGeometry(geom, 0.01);
    expect(out.coordinates[0].length).toBeLessThan(denseRing.length);
    expect(out).not.toBe(geom); // new object, input not mutated
    expect(geom.coordinates[0].length).toBe(denseRing.length);
  });

  it("simplifies every ring of a MultiPolygon", () => {
    const geom = { type: "MultiPolygon", coordinates: [[denseRing], [denseRing]] };
    const out = simplifyGeometry(geom, 0.01);
    expect(out.coordinates[0][0].length).toBeLessThan(denseRing.length);
    expect(out.coordinates[1][0].length).toBeLessThan(denseRing.length);
  });

  it("passes non-polygon / empty geometry through untouched", () => {
    const pt = { type: "Point", coordinates: [1, 2] };
    expect(simplifyGeometry(pt, 0.01)).toBe(pt);
    expect(simplifyGeometry(null, 0.01)).toBeNull();
    expect(simplifyGeometry({ type: "Polygon" } as { type: string; coordinates?: unknown }, 0.01)).toEqual({
      type: "Polygon",
    });
  });
});

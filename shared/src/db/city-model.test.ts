import { cityGeoWithinBox } from "./city-model";

/** Pull the polygon/multipolygon rings back out of the $geoWithin filter. */
function ringsOf(filter: Record<string, unknown>): [number, number][][] {
  const geom = (filter as any).$geoWithin.$geometry;
  if (geom.type === "Polygon") return geom.coordinates as [number, number][][];
  return (geom.coordinates as [number, number][][][]).map((poly) => poly[0]);
}

describe("cityGeoWithinBox", () => {
  it("a small box is a single CCW polygon", () => {
    const f = cityGeoWithinBox(10, -5, 20, 5);
    expect((f as any).$geoWithin.$geometry.type).toBe("Polygon");
    const [ring] = ringsOf(f);
    // CCW from SW: [w,s] [e,s] [e,n] [w,n] [w,s] — interior on the left.
    expect(ring).toEqual([
      [10, -5],
      [20, -5],
      [20, 5],
      [10, 5],
      [10, -5],
    ]);
  });

  it("clamps latitude to ±90 and orders south<north", () => {
    const f = cityGeoWithinBox(0, 95, 10, -95); // swapped + out of range
    const [ring] = ringsOf(f);
    const lats = ring.map((p) => p[1]);
    expect(Math.min(...lats)).toBe(-90);
    expect(Math.max(...lats)).toBe(90);
  });

  it("a box across the antimeridian splits at ±180", () => {
    const f = cityGeoWithinBox(176, -10, -178, 10); // 176°E → 178°W, spans the seam
    expect((f as any).$geoWithin.$geometry.type).toBe("MultiPolygon");
    const rings = ringsOf(f);
    const spans = rings.map((r) => [Math.min(...r.map((p) => p[0])), Math.max(...r.map((p) => p[0]))]);
    // One piece hugs the +180 edge, the other starts at -180 — neither crosses.
    expect(spans).toContainEqual([176, 180]);
    expect(spans).toContainEqual([-180, -178]);
    // Every emitted ring stays under a hemisphere wide.
    for (const [lo, hi] of spans) expect(hi - lo).toBeLessThanOrEqual(180);
  });

  it("a full-world box covers every longitude in ≤120° slices", () => {
    const f = cityGeoWithinBox(-180, -90, 180, 90);
    const rings = ringsOf(f);
    let covered = 0;
    for (const r of rings) {
      const lo = Math.min(...r.map((p) => p[0]));
      const hi = Math.max(...r.map((p) => p[0]));
      expect(hi - lo).toBeLessThanOrEqual(120 + 1e-6);
      covered += hi - lo;
    }
    expect(covered).toBeCloseTo(360, 5); // the slices tile the whole globe
  });
});

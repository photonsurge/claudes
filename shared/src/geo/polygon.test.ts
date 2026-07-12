import { polygonAreaKm2, bboxOf, padBbox, unionBboxOfAlert, type GeoLike } from "./polygon";

// A 1°×1° box on the equator is ~12,300 km² (111 km per side). We assert the
// spherical estimate lands within a couple percent of that.
const unitBox = (w: number, s: number): GeoLike => ({
  type: "Polygon",
  coordinates: [[[w, s], [w + 1, s], [w + 1, s + 1], [w, s + 1], [w, s]]],
});

describe("polygonAreaKm2", () => {
  it("estimates a 1°×1° equatorial box at ~12,300 km²", () => {
    const km2 = polygonAreaKm2(unitBox(0, 0));
    expect(km2).toBeGreaterThan(12_000);
    expect(km2).toBeLessThan(12_700);
  });

  it("is orientation-independent (CW ring == CCW ring)", () => {
    const cw: GeoLike = { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
    const ccw = unitBox(0, 0);
    expect(polygonAreaKm2(cw)).toBeCloseTo(polygonAreaKm2(ccw), 0);
  });

  it("subtracts holes from the outer ring", () => {
    const solid = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
    const holed: GeoLike = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
        [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]],
      ],
    };
    expect(polygonAreaKm2(holed)).toBeLessThan(polygonAreaKm2(solid));
    expect(polygonAreaKm2(holed)).toBeGreaterThan(0);
  });

  it("sums MultiPolygon parts", () => {
    const one = polygonAreaKm2(unitBox(0, 0));
    const multi: GeoLike = {
      type: "MultiPolygon",
      coordinates: [unitBox(0, 0).coordinates as unknown[], unitBox(10, 0).coordinates as unknown[]],
    };
    expect(polygonAreaKm2(multi)).toBeCloseTo(one * 2, -1);
  });

  it("returns 0 for points, null, and malformed input", () => {
    expect(polygonAreaKm2({ type: "Point", coordinates: [1, 2] })).toBe(0);
    expect(polygonAreaKm2(null)).toBe(0);
    expect(polygonAreaKm2({ type: "Polygon", coordinates: "nope" as unknown })).toBe(0);
  });
});

describe("bboxOf", () => {
  it("finds the extent of a polygon", () => {
    expect(bboxOf(unitBox(-5, -3))).toEqual([-5, -3, -4, -2]);
  });

  it("walks a MultiPolygon", () => {
    const multi: GeoLike = {
      type: "MultiPolygon",
      coordinates: [unitBox(0, 0).coordinates as unknown[], unitBox(10, 10).coordinates as unknown[]],
    };
    expect(bboxOf(multi)).toEqual([0, 0, 11, 11]);
  });

  it("handles a Point", () => {
    expect(bboxOf({ type: "Point", coordinates: [3, 4] })).toEqual([3, 4, 3, 4]);
  });

  it("returns null for missing/empty coordinates", () => {
    expect(bboxOf(null)).toBeNull();
    expect(bboxOf({ type: "Polygon", coordinates: [] })).toBeNull();
  });
});

describe("padBbox", () => {
  it("expands by a fraction of span and clamps to valid lng/lat", () => {
    const [w, s, e, n] = padBbox([0, 0, 10, 10], { frac: 0.1, minDeg: 0 });
    expect(w).toBeCloseTo(-1);
    expect(s).toBeCloseTo(-1);
    expect(e).toBeCloseTo(11);
    expect(n).toBeCloseTo(11);
  });

  it("applies the minDeg floor for a tiny/point bbox", () => {
    const [w, s, e, n] = padBbox([5, 5, 5, 5], { frac: 0.25, minDeg: 0.5 });
    expect(e - w).toBeCloseTo(1);
    expect(n - s).toBeCloseTo(1);
  });

  it("never exceeds the world envelope", () => {
    const [w, s, e, n] = padBbox([-179, -89, 179, 89], { frac: 1, minDeg: 5 });
    expect(w).toBe(-180);
    expect(s).toBe(-90);
    expect(e).toBe(180);
    expect(n).toBe(90);
  });
});

describe("unionBboxOfAlert", () => {
  it("merges every area geometry across info[]", () => {
    const bb = unionBboxOfAlert([
      { area: [{ geometry: unitBox(0, 0) }] },
      { area: [{ geometry: unitBox(10, 10) }, { geometry: null }] },
    ]);
    expect(bb).toEqual([0, 0, 11, 11]);
  });

  it("returns null for a geocode-only alert (no geometry)", () => {
    expect(unionBboxOfAlert([{ area: [{ geometry: null }] }])).toBeNull();
    expect(unionBboxOfAlert(undefined)).toBeNull();
  });
});

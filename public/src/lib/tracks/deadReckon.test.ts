import { advance, knotsToMS } from "./deadReckon";

describe("advance (dead reckoning)", () => {
  it("returns the start point when there's nothing to project", () => {
    expect(advance(10, 50, undefined, 200, 60)).toEqual([10, 50]);
    expect(advance(10, 50, 90, 0, 60)).toEqual([10, 50]);
    expect(advance(10, 50, 90, 200, 0)).toEqual([10, 50]);
  });

  it("moves due north (heading 0) by increasing latitude only", () => {
    // ~111.32 km per degree of latitude; 100 m/s * 60 s = 6 km ≈ 0.0539°.
    const [lng, lat] = advance(10, 50, 0, 100, 60);
    expect(lng).toBeCloseTo(10, 4);
    expect(lat).toBeGreaterThan(50);
    expect(lat - 50).toBeCloseTo(0.0539, 2);
  });

  it("moves due east (heading 90) by increasing longitude only", () => {
    const [lng, lat] = advance(10, 0, 90, 100, 60);
    expect(lat).toBeCloseTo(0, 4);
    expect(lng).toBeGreaterThan(10);
  });

  it("normalises longitude across the antimeridian", () => {
    const [lng] = advance(179.99, 0, 90, 300, 600); // ~180 km east, wraps
    expect(lng).toBeGreaterThanOrEqual(-180);
    expect(lng).toBeLessThan(0);
  });

  it("converts knots to m/s", () => {
    expect(knotsToMS(10)).toBeCloseTo(5.14444, 4);
  });
});

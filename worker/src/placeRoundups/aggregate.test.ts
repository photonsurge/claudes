import { inBbox, bboxCenter } from "./aggregate";

describe("inBbox", () => {
  const uk: [number, number, number, number] = [-8, 49, 2, 61];

  it("accepts a point inside the box", () => {
    expect(inBbox(-0.1, 51.5, uk)).toBe(true); // London
  });

  it("rejects a point outside the box", () => {
    expect(inBbox(2.35, 48.85, uk)).toBe(false); // Paris (east + south of the box)
  });

  it("rejects on latitude alone", () => {
    expect(inBbox(-1, 40, uk)).toBe(false);
  });

  it("handles an antimeridian-wrapping box (west > east)", () => {
    const pacific: [number, number, number, number] = [170, -20, -170, 20];
    expect(inBbox(179, 0, pacific)).toBe(true);
    expect(inBbox(-179, 0, pacific)).toBe(true);
    expect(inBbox(0, 0, pacific)).toBe(false);
  });
});

describe("bboxCenter", () => {
  it("centres a normal box and floors the radius", () => {
    const c = bboxCenter([-8, 49, 2, 61]);
    expect(c.lng).toBeCloseTo(-3);
    expect(c.lat).toBeCloseTo(55);
    expect(c.radiusKm).toBeGreaterThanOrEqual(150);
  });

  it("keeps a tiny place above the radius floor", () => {
    const c = bboxCenter([0, 0, 0.1, 0.1]);
    expect(c.radiusKm).toBe(150);
  });

  it("centres a wrapping box on the far side of the antimeridian", () => {
    const c = bboxCenter([170, -10, -170, 10]);
    // Span is 20° across ±180 → centre sits at 180/-180, not 0.
    expect(Math.abs(Math.abs(c.lng) - 180)).toBeLessThan(0.001);
  });
});

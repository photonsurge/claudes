import { sparklinePath } from "./sparkline";

describe("sparklinePath", () => {
  it("returns empty geometry for no samples", () => {
    expect(sparklinePath([], 100, 20)).toEqual({ d: "", last: null });
  });

  it("maps an ascending series to a bottom-left → top-right line", () => {
    const { d, last } = sparklinePath(
      [
        { t: 0, v: 0 },
        { t: 10, v: 10 },
      ],
      100,
      20,
      2,
    );
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("L");
    // last point is at the right edge, near the top (low y).
    expect(last![0]).toBeCloseTo(98, 0);
    expect(last![1]).toBeCloseTo(2, 0);
  });

  it("handles a flat series without dividing by zero", () => {
    const { d } = sparklinePath(
      [
        { t: 0, v: 5 },
        { t: 5, v: 5 },
      ],
      50,
      10,
    );
    expect(d).not.toContain("NaN");
  });
});

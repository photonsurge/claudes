import { syntheticWind, syntheticTemp } from "./synthetic";

describe("syntheticWind", () => {
  it("returns u/v arrays of width*height length", () => {
    const w = 360;
    const h = 181;
    const { u, v } = syntheticWind(w, h);
    expect(u.length).toBe(w * h);
    expect(v.length).toBe(w * h);
    expect(u).toBeInstanceOf(Float32Array);
    expect(v).toBeInstanceOf(Float32Array);
    // all finite, within a sane physical band
    for (let i = 0; i < u.length; i += 997) {
      expect(Number.isFinite(u[i])).toBe(true);
      expect(Math.abs(u[i])).toBeLessThanOrEqual(40);
      expect(Math.abs(v[i])).toBeLessThanOrEqual(40);
    }
  });
});

describe("syntheticTemp", () => {
  it("returns a width*height array, warm at equator and cold at poles", () => {
    const w = 360;
    const h = 181;
    const t = syntheticTemp(w, h);
    expect(t.length).toBe(w * h);
    // row 0 = north pole (cold), middle row = equator (warm)
    const poleVal = t[0];
    const eqRow = Math.floor(h / 2);
    const eqVal = t[eqRow * w];
    expect(eqVal).toBeGreaterThan(poleVal);
  });
});

import { syntheticWind, syntheticTemp, syntheticSst, syntheticSstAtDepth } from "./synthetic";

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

describe("syntheticSstAtDepth", () => {
  const w = 360;
  const h = 181;

  it("moves monotonically toward the abyssal baseline as depth increases", () => {
    // The exponential decay pulls every point toward ABYSS_C — in the warm
    // tropics that means cooling with depth, but near the poles (where the
    // synthetic surface dips colder than the abyssal baseline) it means
    // WARMING with depth, same as real polar water columns can show a cold
    // fresh surface lens over relatively warmer deep water. The universal
    // invariant is the distance to the baseline shrinking, not "always colder".
    const abyss = syntheticSstAtDepth(5000)(w, h)[0]; // ~constant everywhere by 5000m
    const surface = syntheticSst(w, h);
    const at100 = syntheticSstAtDepth(100)(w, h);
    const at2000 = syntheticSstAtDepth(2000)(w, h);
    for (let i = 0; i < surface.length; i += 997) {
      const d0 = Math.abs(surface[i] - abyss);
      const d100 = Math.abs(at100[i] - abyss);
      const d2000 = Math.abs(at2000[i] - abyss);
      expect(d100).toBeLessThanOrEqual(d0 + 1e-9);
      expect(d2000).toBeLessThanOrEqual(d100 + 1e-9);
    }
  });

  it("converges toward the abyssal baseline as depth grows", () => {
    const abyss = syntheticSstAtDepth(5000)(w, h);
    // Equator and pole should both be near-uniform and close to ~1.5°C by 5000m.
    const eqRow = Math.floor(h / 2);
    expect(Math.abs(abyss[eqRow * w] - abyss[0])).toBeLessThan(1);
  });

  it("returns a width*height Float32Array", () => {
    const out = syntheticSstAtDepth(500)(w, h);
    expect(out.length).toBe(w * h);
    expect(out).toBeInstanceOf(Float32Array);
  });
});

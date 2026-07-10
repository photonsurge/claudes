import { orbitAmpCap, ORBIT_MAX_FRAC, ORBIT_VIS_HALF_K } from "./orbit-frame";

describe("orbitAmpCap", () => {
  it("shrinks the cap as the shot zooms in (tighter frame → smaller pan)", () => {
    // Each +1 zoom halves the visible extent, so it halves the allowed pan.
    expect(orbitAmpCap(4)).toBeCloseTo(orbitAmpCap(3) / 2, 6);
    expect(orbitAmpCap(5)).toBeLessThan(orbitAmpCap(4));
  });

  it("keeps a country-zoom pan small enough to stay framed", () => {
    // Spain frames at zoom 4.5 with ~6.6° visible half-height; the old fixed 5°
    // orbit dragged it off the top. The cap must be a small slice of that.
    const cap = orbitAmpCap(4.5);
    expect(cap).toBeGreaterThan(0.5); // still enough to read as motion
    expect(cap).toBeLessThan(2); // never the old 5° that ejected the subject
  });

  it("matches the ORBIT_MAX_FRAC · half-height formula", () => {
    const zoom = 3.3; // wide continental framing (USA / China)
    const visHalf = ORBIT_VIS_HALF_K / Math.pow(2, zoom);
    expect(orbitAmpCap(zoom)).toBeCloseTo(ORBIT_MAX_FRAC * visHalf, 6);
  });

  it("only ever tightens a preset drift, never amplifies it", () => {
    // The intended usage: min(orbitDrift, cap). At every country zoom the cap is
    // below the presets' 5–6° so the drift is always the one that gets clamped.
    for (const zoom of [3.0, 3.5, 4.0, 4.5, 5.0]) {
      expect(orbitAmpCap(zoom)).toBeLessThan(5);
    }
  });
});

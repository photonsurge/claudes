import {
  SOURCE_REGISTRY,
  getSource,
  enabledSources,
  sourcesForVariable,
  preferredSource,
} from "./sources";
import { VARIABLE_REGISTRY } from "./variables";

describe("SOURCE_REGISTRY integrity", () => {
  const ids = Object.keys(SOURCE_REGISTRY);

  it.each(ids)("%s is internally consistent", (id) => {
    const s = SOURCE_REGISTRY[id];
    expect(s.id).toBe(id);
    expect(s.label.length).toBeGreaterThan(0);
    expect(s.resolutionDeg).toBeGreaterThan(0);
    expect(s.bbox).toHaveLength(4);
    const [w, sN, e, n] = s.bbox;
    expect(w).toBeLessThan(e);
    expect(sN).toBeLessThan(n);
    expect(s.variables.length).toBeGreaterThan(0);
    // Every supplied variable must exist in the variable registry.
    for (const v of s.variables) expect(VARIABLE_REGISTRY[v]).toBeDefined();
  });

  it("getSource resolves known/unknown ids", () => {
    expect(getSource("gfs")?.id).toBe("gfs");
    expect(getSource("nope")).toBeUndefined();
  });
});

describe("supplier resolution", () => {
  it("enabledSources excludes flagged-off sources (ifs default off)", () => {
    const on = enabledSources().map((s) => s.id);
    expect(on).toContain("gfs");
    expect(on).toContain("rtofs");
    expect(on).not.toContain("ifs");
  });

  it("sst is supplied by both gfs (fallback) and rtofs (preferred), rtofs first", () => {
    const srcs = sourcesForVariable("sst").map((s) => s.id);
    expect(srcs).toContain("gfs");
    expect(srcs).toContain("rtofs");
    // Highest priority first — RTOFS (real ocean) beats GFS-masked.
    expect(srcs[0]).toBe("rtofs");
  });

  it("preferredSource returns the highest-priority ENABLED source", () => {
    expect(preferredSource("sst")?.id).toBe("rtofs");
    // wave: 0p16 enabled + higher priority than the disabled 0p25 fallback.
    expect(preferredSource("wave")?.id).toBe("gfswave-0p16");
    // current is RTOFS-only.
    expect(preferredSource("current")?.id).toBe("rtofs");
  });

  it("ocean-only variables resolve to RTOFS", () => {
    expect(sourcesForVariable("current").map((s) => s.id)).toEqual(["rtofs"]);
    expect(sourcesForVariable("salinity").map((s) => s.id)).toEqual(["rtofs"]);
  });

  it("finer sources outrank coarser for the same variable", () => {
    const wave = sourcesForVariable("wave");
    const p16 = wave.find((s) => s.id === "gfswave-0p16")!;
    const p25 = wave.find((s) => s.id === "gfswave-0p25")!;
    expect(p16.priority).toBeGreaterThan(p25.priority);
    expect(p16.resolutionDeg).toBeLessThan(p25.resolutionDeg);
  });
});

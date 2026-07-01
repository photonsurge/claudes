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

  it("sst is supplied by both gfs (fallback) and rtofs (preferred), rtofs above gfs", () => {
    const srcs = sourcesForVariable("sst").map((s) => s.id);
    expect(srcs).toContain("gfs");
    expect(srcs).toContain("rtofs");
    // Real ocean (RTOFS + its regional nests) beats GFS-masked SST: every RTOFS
    // supplier outranks GFS. (Regional RTOFS nests, when present, sort above the
    // global rtofs base — but all are above gfs.)
    const globalRtofsBase = sourcesForVariable("sst").filter((s) => s.minZoom === undefined);
    expect(globalRtofsBase[0].id).toBe("rtofs");
    expect(srcs.indexOf("rtofs")).toBeLessThan(srcs.indexOf("gfs"));
  });

  it("preferredSource returns the highest-priority ENABLED source", () => {
    // sst preferred supplier is an RTOFS product (a regional RTOFS nest when one
    // covers, else the global rtofs base) — always above GFS-masked SST.
    expect(preferredSource("sst")?.id).toMatch(/^rtofs/);
    // wave: the regional basin NESTS (Phase 2a, priority 25) outrank the global
    // mosaic (20), which itself outranks the 0p25 global base (10). The client
    // stacks a nest over the mosaic inside its bbox and falls back to the mosaic
    // elsewhere.
    expect(preferredSource("wave")?.id).toBe("gfswave-atlocn");
    // The mosaic remains the highest-priority always-on GLOBAL base (non-nest).
    const globalWaveBases = sourcesForVariable("wave").filter((s) => s.minZoom === undefined);
    expect(globalWaveBases[0].id).toBe("gfswave-mosaic");
    // current is RTOFS-only (base or a regional RTOFS nest).
    expect(preferredSource("current")?.variables).toContain("current");
    expect(preferredSource("current")?.id).toMatch(/^rtofs/);
  });

  it("ocean-only variables resolve to RTOFS (base + any regional RTOFS nests)", () => {
    for (const v of ["current", "salinity"]) {
      const srcs = sourcesForVariable(v);
      expect(srcs.length).toBeGreaterThan(0);
      // Every supplier of an ocean-only variable is an RTOFS product.
      for (const s of srcs) expect(s.id).toMatch(/^rtofs/);
      // The global rtofs base is among them.
      expect(srcs.map((s) => s.id)).toContain("rtofs");
    }
  });

  it("finer sources outrank coarser for the same variable", () => {
    const wave = sourcesForVariable("wave");
    const mosaic = wave.find((s) => s.id === "gfswave-mosaic")!;
    const p25 = wave.find((s) => s.id === "gfswave-0p25")!;
    expect(mosaic.priority).toBeGreaterThan(p25.priority);
    expect(mosaic.resolutionDeg).toBeLessThan(p25.resolutionDeg);
  });
});

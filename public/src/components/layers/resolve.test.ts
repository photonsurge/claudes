import type { WeatherVariableManifest } from "@photonsurge/shared/manifest";
import {
  defaultMinZoom,
  nestMinZoom,
  bboxContains,
  bboxContainsBbox,
  viewCentralBbox,
  nestActive,
  resolveEntries,
  activeNestSignature,
} from "./resolve";

/** Minimal manifest entry with overrides. */
const entry = (over: Partial<WeatherVariableManifest>): WeatherVariableManifest => ({
  encoding: "scalar",
  units: "x",
  files: { "0": "u" },
  ...over,
});

const CONUS: [number, number, number, number] = [-134, 21, -60, 53];
const EUROPE: [number, number, number, number] = [-4, 43, 20, 58];

describe("defaultMinZoom", () => {
  it("is monotonic: finer resolution ⇒ higher zoom floor", () => {
    expect(defaultMinZoom(0.25)).toBeCloseTo(2); // == global base ⇒ floor
    expect(defaultMinZoom(0.125)).toBeCloseTo(3); // one halving ⇒ +1
    expect(defaultMinZoom(0.03)).toBeGreaterThan(defaultMinZoom(0.125));
  });

  it("clamps to the 2..6 range", () => {
    expect(defaultMinZoom(10)).toBe(2); // coarser than base
    expect(defaultMinZoom(0.0001)).toBe(6); // absurdly fine
  });
});

describe("nestMinZoom", () => {
  // Every floor is lowered by 1 (clamped ≥2.5) so nests become ELIGIBLE ~1 zoom
  // level earlier; the best-fit winner (coverage-gated) stops that showing seams.
  it("prefers an explicit minZoom (lowered by 1) over the derived default", () => {
    expect(nestMinZoom(entry({ minZoom: 4.2, resolutionDeg: 0.02 }))).toBeCloseTo(3.2);
  });
  it("derives from resolutionDeg when minZoom is absent (then lowers, clamped ≥2.5)", () => {
    expect(nestMinZoom(entry({ resolutionDeg: 0.125 }))).toBeCloseTo(2.5); // 3 − 1 → clamp 2.5
    expect(nestMinZoom(entry({ resolutionDeg: 0.02 }))).toBeCloseTo(defaultMinZoom(0.02) - 1);
  });
  it("falls back to 3 (→2.5 after lowering) when neither is present", () => {
    expect(nestMinZoom(entry({}))).toBeCloseTo(2.5);
  });
});

describe("viewCentralBbox + bboxContainsBbox (best-fit coverage)", () => {
  it("shrinks with zoom (a closer view needs less coverage)", () => {
    const wide = viewCentralBbox({ center: [-2, 54], zoom: 4 });
    const tight = viewCentralBbox({ center: [-2, 54], zoom: 6 });
    const span = (b: [number, number, number, number]) => b[2] - b[0];
    expect(span(tight)).toBeLessThan(span(wide));
  });

  it("is centred on the camera", () => {
    const b = viewCentralBbox({ center: [10, 40], zoom: 5 });
    expect((b[0] + b[2]) / 2).toBeCloseTo(10);
    expect((b[1] + b[3]) / 2).toBeCloseTo(40);
  });

  it("a UK-spanning nest covers a close UK view; a France nest cut at 55.4°N does not", () => {
    const view = viewCentralBbox({ center: [-2, 54], zoom: 6 });
    const ukv: [number, number, number, number] = [-12, 48, 4.992, 60.996];
    const aromeFrance: [number, number, number, number] = [-12, 37.5, 16, 55.4];
    expect(bboxContainsBbox(ukv, view)).toBe(true);
    expect(bboxContainsBbox(aromeFrance, view)).toBe(false); // north edge cuts the view
  });
});

describe("bboxContains", () => {
  it("inside / outside / inclusive edges", () => {
    expect(bboxContains(CONUS, -100, 40)).toBe(true); // Kansas
    expect(bboxContains(CONUS, 10, 50)).toBe(false); // Europe
    expect(bboxContains(CONUS, -134, 21)).toBe(true); // SW corner inclusive
    expect(bboxContains(CONUS, -60, 53)).toBe(true); // NE corner inclusive
  });
});

describe("nestActive", () => {
  const conus = entry({ sourceId: "hrrr", bbox: CONUS, minZoom: 3.5 }); // floor → 2.5 after lowering

  it("active only when zoomed in AND centred inside the bbox", () => {
    expect(nestActive(conus, { center: [-100, 40], zoom: 4 })).toBe(true);
    expect(nestActive(conus, { center: [-100, 40], zoom: 2 })).toBe(false); // below 2.5 floor
    expect(nestActive(conus, { center: [10, 50], zoom: 5 })).toBe(false); // outside bbox
  });

  it("is inactive with no bbox regardless of zoom", () => {
    expect(nestActive(entry({ minZoom: 0 }), { center: [0, 0], zoom: 10 })).toBe(false);
  });

  it("uses the derived floor when minZoom is omitted", () => {
    const fine = entry({ bbox: CONUS, resolutionDeg: 0.03 }); // derived ≈5.06, lowered ≈4.06
    expect(nestActive(fine, { center: [-100, 40], zoom: 4 })).toBe(false);
    expect(nestActive(fine, { center: [-100, 40], zoom: 5 })).toBe(true);
  });
});

describe("resolveEntries", () => {
  const eu = entry({ sourceId: "icon-d2", bbox: EUROPE, minZoom: 3.5, files: { "0": "eu" } });
  const us = entry({ sourceId: "hrrr", bbox: CONUS, minZoom: 3.5, files: { "0": "us" } });
  const base = entry({ sourceId: "gfs", files: { "0": "base" }, nests: [eu, us] });

  it("returns [] for a missing entry", () => {
    expect(resolveEntries(undefined, { center: [0, 0], zoom: 5 })).toEqual([]);
  });

  it("returns the base alone when zoomed out", () => {
    const r = resolveEntries(base, { center: [-100, 40], zoom: 2 });
    expect(r.map((e) => e.sourceId)).toEqual(["gfs"]);
  });

  it("appends the nest whose bbox holds the centre (base always first)", () => {
    expect(resolveEntries(base, { center: [-100, 40], zoom: 5 }).map((e) => e.sourceId)).toEqual([
      "gfs",
      "hrrr",
    ]);
    expect(resolveEntries(base, { center: [10, 50], zoom: 5 }).map((e) => e.sourceId)).toEqual([
      "gfs",
      "icon-d2",
    ]);
  });

  it("keeps a nest-only base (empty files) in the list — downstream skips it", () => {
    const radarBase = entry({ sourceId: "mrms", files: {}, nests: [us] });
    const r = resolveEntries(radarBase, { center: [-100, 40], zoom: 5 });
    expect(r.map((e) => e.sourceId)).toEqual(["mrms", "hrrr"]);
    expect(Object.keys(r[0].files)).toHaveLength(0); // base yields no layer
  });
});

describe("activeNestSignature", () => {
  const us = entry({ sourceId: "hrrr", bbox: CONUS, minZoom: 3.5, files: { "0": "us" } });
  const base = entry({ sourceId: "gfs", files: { "0": "base" }, nests: [us] });

  it("is empty when no nest is active (or there are no nests)", () => {
    expect(activeNestSignature(base, { center: [-100, 40], zoom: 2 })).toBe("");
    expect(activeNestSignature(entry({}), { center: [0, 0], zoom: 9 })).toBe("");
  });

  it("changes when a nest flips active — the Globe keys its effects on this", () => {
    const outside = activeNestSignature(base, { center: [0, 0], zoom: 5 });
    const inside = activeNestSignature(base, { center: [-100, 40], zoom: 5 });
    expect(outside).toBe("");
    expect(inside).toBe("hrrr");
    expect(inside).not.toBe(outside);
  });
});

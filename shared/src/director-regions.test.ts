import {
  REGION_SHOTS,
  regionShot,
  cameraForBbox,
  DEFAULT_DIRECTOR_REGIONS,
  sanitizeDirectorRegions,
} from "./director-regions";
import { REGION_PRESETS } from "./regions";

describe("REGION_SHOTS catalog", () => {
  it("has unique ids and a derived, in-bounds framing for every area", () => {
    const ids = REGION_SHOTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REGION_SHOTS) {
      expect(r.name.length).toBeGreaterThan(0);
      const [w, s, e, n] = r.bbox;
      // The derived framing centre falls inside its own bbox.
      expect(r.center[0]).toBeGreaterThanOrEqual(w);
      expect(r.center[0]).toBeLessThanOrEqual(e);
      expect(r.center[1]).toBeGreaterThanOrEqual(s);
      expect(r.center[1]).toBeLessThanOrEqual(n);
      // Zoom stays in the broadcast range (continents pull back, bands push in).
      expect(r.zoom).toBeGreaterThanOrEqual(1.2);
      expect(r.zoom).toBeLessThanOrEqual(5.0);
    }
  });

  it("excludes oceans and the whole-planet 'world' framing", () => {
    const ids = new Set(REGION_SHOTS.map((r) => r.id));
    expect(ids.has("world")).toBe(false);
    // Every ocean-group preset is dropped.
    for (const p of REGION_PRESETS) {
      if (p.group === "ocean") expect(ids.has(p.id)).toBe(false);
    }
    // A land region / continent survives.
    expect(ids.has("europe")).toBe(true);
  });

  it("looks up by id and misses unknowns", () => {
    expect(regionShot("europe")?.name).toBe("Europe");
    expect(regionShot("nope")).toBeUndefined();
  });

  it("defaults to no favourites (the region kind is opt-in)", () => {
    expect(DEFAULT_DIRECTOR_REGIONS).toEqual([]);
  });
});

describe("cameraForBbox", () => {
  it("centres on the bbox midpoint", () => {
    const { center } = cameraForBbox([-10, 40, 10, 60]);
    expect(center).toEqual([0, 50]);
  });

  it("zooms further out for a bigger area", () => {
    const small = cameraForBbox([-2, 50, 2, 54]); // ~4°×4°
    const big = cameraForBbox([-60, -20, 60, 40]); // continent-scale
    expect(big.zoom).toBeLessThan(small.zoom);
  });

  it("clamps zoom to the broadcast range", () => {
    const tiny = cameraForBbox([0, 0, 0.01, 0.01]);
    const huge = cameraForBbox([-179, -85, 179, 85]);
    expect(tiny.zoom).toBeLessThanOrEqual(5.0);
    expect(huge.zoom).toBeGreaterThanOrEqual(1.2);
  });
});

describe("sanitizeDirectorRegions", () => {
  it("rejects non-arrays (merge keeps the base)", () => {
    expect(sanitizeDirectorRegions(undefined)).toBeNull();
    expect(sanitizeDirectorRegions("europe")).toBeNull();
    expect(sanitizeDirectorRegions({ europe: true })).toBeNull();
  });

  it("keeps only known ids, deduped, in catalog order", () => {
    const first = REGION_SHOTS[0].id;
    const second = REGION_SHOTS[1].id;
    expect(sanitizeDirectorRegions([second, "atlantis", first, second, 42])).toEqual([
      first,
      second,
    ]);
  });

  it("drops oceans/'world' even if an operator posts them", () => {
    expect(sanitizeDirectorRegions(["world", "pacific"])).toEqual([]);
  });

  it("allows an empty favourites list", () => {
    expect(sanitizeDirectorRegions([])).toEqual([]);
  });
});

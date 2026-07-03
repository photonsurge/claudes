import { REGION_PRESETS, REGION_GROUPS, getRegion, regionsInGroup, favoriteRegions } from "./regions";
import { BASEMAPS, getBasemap, DEFAULT_BASEMAP_ID } from "./basemaps";
import { PALETTES } from "./palettes";
import { textureUrl } from "./manifest";

describe("REGION_PRESETS", () => {
  const groupIds = new Set(REGION_GROUPS.map((g) => g.id));

  it.each(REGION_PRESETS)("$id has a valid bbox", (r) => {
    const [w, s, e, n] = r.bbox;
    expect(r.bbox).toHaveLength(4);
    // Longitude may run east past +180 for an antimeridian-centred ocean, but
    // must stay ordered and no wider than the globe.
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(e).toBeLessThanOrEqual(360);
    expect(w).toBeLessThan(e);
    expect(e - w).toBeLessThanOrEqual(360);
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
    expect(s).toBeLessThan(n);
  });
  it.each(REGION_PRESETS)("$id belongs to a declared group", (r) => {
    expect(groupIds.has(r.group)).toBe(true);
  });
  it("has unique preset ids", () => {
    const ids = REGION_PRESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every group holds at least one preset", () => {
    for (const g of REGION_GROUPS) expect(regionsInGroup(g.id).length).toBeGreaterThan(0);
  });
  it("exposes a non-empty curated Favorites strip", () => {
    const favs = favoriteRegions();
    expect(favs.length).toBeGreaterThan(0);
    expect(favs.every((r) => r.favorite)).toBe(true);
  });
  it("includes western_europe and conus and looks them up", () => {
    expect(getRegion("western_europe")).toBeDefined();
    expect(getRegion("conus")).toBeDefined();
    expect(getRegion("nope")).toBeUndefined();
  });
});

describe("BASEMAPS", () => {
  it("has the switchable styles", () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual(
      expect.arrayContaining(["dark", "satellite", "terrain", "night", "relief"]),
    );
  });
  it("night tiles stop at the GIBS zoom-8 pyramid", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const style = BASEMAPS.find((b) => b.id === "night")!.style as any;
    const src = Object.values(style.sources)[0] as { maxzoom: number };
    expect(src.maxzoom).toBe(8);
  });
  it.each(BASEMAPS)("$id is a usable MapLibre raster style", (b) => {
    const style = b.style as any;
    expect(style.version).toBe(8);
    expect(Object.keys(style.sources).length).toBeGreaterThan(0);
    expect(Array.isArray(style.layers)).toBe(true);
    const src = Object.values(style.sources)[0] as any;
    expect(src.type).toBe("raster");
    expect(src.tiles.length).toBeGreaterThan(0);
    expect(typeof src.attribution).toBe("string");
  });
  it("getBasemap falls back to the first basemap", () => {
    expect(getBasemap("nope").id).toBe(BASEMAPS[0].id);
    expect(getBasemap(DEFAULT_BASEMAP_ID).id).toBe(DEFAULT_BASEMAP_ID);
  });
});

describe("PALETTES", () => {
  it.each(Object.entries(PALETTES))("%s has monotonic stops and valid hex", (_id, palette) => {
    expect(palette.length).toBeGreaterThan(1);
    let prev = -1;
    for (const [stop, color] of palette) {
      expect(stop).toBeGreaterThanOrEqual(0);
      expect(stop).toBeLessThanOrEqual(1);
      expect(stop).toBeGreaterThanOrEqual(prev);
      prev = stop;
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("textureUrl", () => {
  it("builds the route URL (with .png so the image loader can select) from a texture id", () => {
    expect(textureUrl("abc")).toBe("/api/weather/tex/abc.png");
  });
});

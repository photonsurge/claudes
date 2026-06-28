import { REGION_PRESETS, getRegion } from "./regions";
import { BASEMAPS, getBasemap, DEFAULT_BASEMAP_ID } from "./basemaps";
import { PALETTES } from "./palettes";
import { textureUrl } from "./manifest";

describe("REGION_PRESETS", () => {
  it.each(REGION_PRESETS)("$id has a valid bbox", (r) => {
    const [w, s, e, n] = r.bbox;
    expect(r.bbox).toHaveLength(4);
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(e).toBeLessThanOrEqual(180);
    expect(w).toBeLessThan(e);
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
    expect(s).toBeLessThan(n);
  });
  it("includes western_europe and conus and looks them up", () => {
    expect(getRegion("western_europe")).toBeDefined();
    expect(getRegion("conus")).toBeDefined();
    expect(getRegion("nope")).toBeUndefined();
  });
});

describe("BASEMAPS", () => {
  it("has the three switchable styles", () => {
    expect(BASEMAPS.map((b) => b.id)).toEqual(
      expect.arrayContaining(["dark", "satellite", "terrain"]),
    );
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

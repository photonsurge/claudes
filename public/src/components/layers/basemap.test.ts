import { hexToRgb, basemapLayers, countriesLayer, TILE_MIN_ZOOM } from "./basemap";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ids = (layers: any[]) => layers.map((l) => l.props.id);
const state = (basemap: string, colors?: Partial<ControlState["basemapColors"]>): ControlState => ({
  ...DEFAULT_CONTROL_STATE,
  basemap,
  basemapColors: { ...DEFAULT_CONTROL_STATE.basemapColors, ...colors },
});

describe("hexToRgb", () => {
  it("parses hex with and without leading #", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#1c222e")).toEqual([28, 34, 46]);
  });
  it("falls back to grey on bad/empty/short input", () => {
    expect(hexToRgb(undefined)).toEqual([128, 128, 128]);
    expect(hexToRgb("")).toEqual([128, 128, 128]);
    expect(hexToRgb("nope")).toEqual([128, 128, 128]);
    expect(hexToRgb("#fff")).toEqual([128, 128, 128]); // 3-digit not supported
  });
});

describe("basemapLayers", () => {
  it("dark = ocean background + land fill, never tiles", () => {
    expect(ids(basemapLayers(state("dark"), false))).toEqual(["basemap-bg", "basemap-land"]);
    expect(ids(basemapLayers(state("dark"), true))).toEqual(["basemap-bg", "basemap-land"]);
  });

  it("satellite = base image; tiles only when zoomed in (tilesActive)", () => {
    expect(ids(basemapLayers(state("satellite"), false))).toEqual([
      "basemap-bg",
      "basemap-image-satellite",
    ]);
    expect(ids(basemapLayers(state("satellite"), true))).toEqual([
      "basemap-bg",
      "basemap-image-satellite",
      "basemap-tiles-satellite",
    ]);
  });

  it("terrain = base image + tiles when active", () => {
    expect(ids(basemapLayers(state("terrain"), true))).toContain("basemap-tiles-terrain");
    expect(ids(basemapLayers(state("terrain"), false))).not.toContain("basemap-tiles-terrain");
  });

  it("dark ocean background uses the operator's ocean colour", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bg = basemapLayers(state("dark", { ocean: "#010203" }), false)[0] as any;
    expect(bg.props.getFillColor).toEqual([1, 2, 3]);
  });

  it("raster basemaps use a near-black background (not the ocean colour)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bg = basemapLayers(state("satellite", { ocean: "#ffffff" }), false)[0] as any;
    expect(bg.props.getFillColor).toEqual([0, 3, 8]);
  });
});

describe("countriesLayer", () => {
  it("draws stroke-only borders above weather with the operator's colour", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = countriesLayer(state("dark", { border: "#ff8800" })) as any;
    expect(l.props.id).toBe("country-borders");
    expect(l.props.filled).toBe(false);
    expect(l.props.stroked).toBe(true);
    expect(l.props.getLineColor).toEqual([255, 136, 0, 170]);
    // Depth-tested (less-equal) so far-side borders are hidden by the globe.
    expect(l.props.parameters.depthCompare).toBe("less-equal");
  });
});

describe("TILE_MIN_ZOOM", () => {
  it("is the zoom gate for the tile overlay", () => {
    expect(TILE_MIN_ZOOM).toBe(4);
  });
});

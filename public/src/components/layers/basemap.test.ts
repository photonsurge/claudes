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
    expect(ids(basemapLayers(state("dark"), false, false))).toEqual(["basemap-bg", "basemap-land"]);
    expect(ids(basemapLayers(state("dark"), true, false))).toEqual(["basemap-bg", "basemap-land"]);
  });

  it("satellite = base image; tiles only when zoomed in (tilesActive)", () => {
    expect(ids(basemapLayers(state("satellite"), false, false))).toEqual([
      "basemap-bg",
      "basemap-image-satellite",
    ]);
    expect(ids(basemapLayers(state("satellite"), true, false))).toEqual([
      "basemap-bg",
      "basemap-image-satellite",
      "basemap-tiles-satellite",
    ]);
  });

  it("terrain = base image + tiles when active", () => {
    expect(ids(basemapLayers(state("terrain"), true, false))).toContain("basemap-tiles-terrain");
    expect(ids(basemapLayers(state("terrain"), false, false))).not.toContain("basemap-tiles-terrain");
  });

  it("dark ocean background uses the operator's ocean colour", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bg = basemapLayers(state("dark", { ocean: "#010203" }), false, false)[0] as any;
    expect(bg.props.getFillColor).toEqual([1, 2, 3]);
  });

  it("raster basemaps use a near-black background (not the ocean colour)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bg = basemapLayers(state("satellite"), false, false)[0] as any;
    expect(bg.props.getFillColor).toEqual([0, 3, 8]);
  });

  // Regression: the background grid must SEAL the depth sphere (write depth) unless
  // something full-globe already does. Otherwise the far hemisphere bleeds through
  // the front ("see-through planet") — the radar reflectivity bug.
  const bgParams = (s: ControlState, hasGlobalRaster: boolean) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (basemapLayers(s, false, hasGlobalRaster)[0] as any).props.parameters;

  it("dark background writes depth when no full-globe raster is drawn", () => {
    // No active variable → background is the sole occluder.
    expect(bgParams(state("dark"), false).depthWriteEnabled).toBe(true);
  });

  it("nest-only variable (radar) keeps the background as the depth occluder", () => {
    // Radar is nest-only: no full-globe raster, so hasGlobalRaster is false and the
    // background must still write depth.
    expect(bgParams({ ...state("dark"), activeVariable: "radar" }, false).depthWriteEnabled).toBe(
      true,
    );
  });

  it("a full-globe raster takes over as occluder (background stops writing depth)", () => {
    // A non-nest-only variable draws a full-globe raster that seals depth itself, so
    // the background steps down to depth-test-only to avoid hiding that raster.
    expect(bgParams({ ...state("dark"), activeVariable: "temp" }, true).depthWriteEnabled).toBe(
      false,
    );
  });

  it("raster basemap (satellite) seals depth via its base image, not the background", () => {
    expect(bgParams(state("satellite"), false).depthWriteEnabled).toBe(false);
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

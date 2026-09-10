import { PathLayer } from "@deck.gl/layers";
import { hexToRgb, basemapLayers, countriesLayer, TILE_MIN_ZOOM } from "./basemap";
import { DEFAULT_CONTROL_STATE, type ControlState } from "@photonsurge/shared/control";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allIds = (layers: any[]) => layers.map((l) => l.props.id);
/** The layers that actually DRAW for this basemap — every basemap's heavy layer
 *  (base images, land fill) stays mounted but hidden, so a map-type step never
 *  rebuilds a texture or a tessellation (round 51). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ids = (layers: any[]) => layers.filter((l) => l.props.visible !== false).map((l) => l.props.id);
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

  it("night = Black Marble base image + zoom-capped GIBS tiles when active", () => {
    expect(ids(basemapLayers(state("night"), false, false))).toEqual([
      "basemap-bg",
      "basemap-image-night",
    ]);
    const zoomed = basemapLayers(state("night"), true, false);
    expect(ids(zoomed)).toContain("basemap-tiles-night");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiles = zoomed.find((l: any) => l.props.id === "basemap-tiles-night") as any;
    // GIBS Black Marble's tile pyramid ends at zoom 8 — deeper views stretch z8 tiles.
    expect(tiles.props.maxZoom).toBe(8);
  });

  it("keeps every base image and the land fill mounted but hidden across basemaps", () => {
    const kept = ["basemap-image-satellite", "basemap-image-terrain", "basemap-image-night", "basemap-land"];
    for (const id of ["dark", "satellite", "terrain", "night", "relief"]) {
      const layers = basemapLayers(state(id), true, false);
      for (const k of kept) expect(allIds(layers)).toContain(k);
      // Exactly one of the kept layers draws (none for relief — Globe adds that raster).
      const drawn = ids(layers).filter((x) => kept.includes(x));
      expect(drawn).toEqual(id === "relief" ? [] : id === "dark" ? ["basemap-land"] : [`basemap-image-${id}`]);
    }
  });

  it("dark ocean background uses the operator's ocean colour", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bg = basemapLayers(state("dark", { ocean: "#010203" }), false, false)[0] as any;
    expect(bg.props.getFillColor).toEqual([1, 2, 3]);
  });

  it("raster basemaps use a near-black background (not the ocean colour)", () => {
    for (const id of ["satellite", "terrain", "night"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bg = basemapLayers(state(id), false, false)[0] as any;
      expect(bg.props.getFillColor).toEqual([0, 3, 8]);
    }
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

  it("raster basemap (satellite) still lets the background seal depth — the image only paints", () => {
    // Regression: the base image used to write its own depth (DEPTH_OCCLUDE), a
    // coarse few-quad mesh that z-fights the finely-tessellated background grid
    // (diamond artifacts near the limb). The background stays the sole writer.
    expect(bgParams(state("satellite"), false).depthWriteEnabled).toBe(true);
  });

  it("night basemap still lets the background seal depth — the image only paints", () => {
    expect(bgParams(state("night"), false).depthWriteEnabled).toBe(true);
  });

  it("the base image is served from /api/basemap/<id> (shared store, admin-refreshable)", () => {
    for (const id of ["satellite", "terrain", "night"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layers = basemapLayers(state(id), false, false) as any[];
      const image = layers.find((l) => l.props.id === `basemap-image-${id}`);
      expect(image.props.image).toBe(`/api/basemap/${id}`);
    }
  });

  it("the base image never depth-tests/writes and culls its own far hemisphere", () => {
    for (const id of ["satellite", "terrain", "night"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const layers = basemapLayers(state(id), false, false) as any[];
      const image = layers.find((l) => l.props.id === `basemap-image-${id}`);
      expect(image.props.parameters.depthTest).toBe(false);
      expect(image.props.parameters.depthWriteEnabled).toBe(false);
      expect(image.props.parameters.cullMode).toBe("back");
    }
  });
});

describe("countriesLayer", () => {
  it("draws the borders as a PathLayer over the country rings with the operator's colour", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const l = countriesLayer(state("dark", { border: "#ff8800" })) as any;
    expect(l).toBeInstanceOf(PathLayer);
    expect(l.props.id).toBe("country-borders");
    expect(l.props.getColor).toEqual([255, 136, 0, 170]);
    expect(l.props.getWidth).toBe(1);
    expect(l.props.widthUnits).toBe("pixels");
    expect(l.props.widthMinPixels).toBe(0.6);
    // No GeoJsonLayer: nothing to earcut a polygons-fill sublayer for.
    expect(l.props.filled).toBeUndefined();
    expect(l.props.stroked).toBeUndefined();
    const ring = { path: [[0, 0], [1, 1]], feature: {} };
    expect(l.props.getPath(ring)).toBe(ring.path);
    // Depth-tested (less-equal) so far-side borders are hidden by the globe.
    expect(l.props.parameters.depthCompare).toBe("less-equal");
  });

  it("hands deck one page-lifetime data promise, so a rebuild never refetches or re-tessellates", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = countriesLayer(state("dark")) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = countriesLayer(state("dark", { border: "#ff8800" })) as any;
    expect(a.props.data).toBeInstanceOf(Promise);
    expect(b.props.data).toBe(a.props.data);
  });
});

describe("TILE_MIN_ZOOM", () => {
  it("is the zoom gate for the tile overlay", () => {
    expect(TILE_MIN_ZOOM).toBe(4);
  });
});

/**
 * Layer-selection tests for the nest-aware builders: when a variable has NO true
 * global base (empty-`files` base, e.g. temp/humidity), the COARSEST loaded nest
 * (icon-global — worldwide bbox) must be promoted to act as the base so the whole
 * globe stays coloured UNDER the fine regional nest, instead of only the fine
 * nest's rectangle rendering. Regression for "regional overlay works but the low-
 * res globe goes black underneath it".
 */
import type { WeatherManifest, WeatherVariableManifest } from "@photonsurge/shared/manifest";

// Capture constructor args instead of building real GL layers.
type Rec = { id?: string; bounds?: unknown; image?: unknown; parameters?: unknown };
const rasterCalls: Rec[] = [];
const particleCalls: Rec[] = [];
jest.mock("weatherlayers-gl", () => ({
  RasterLayer: class { constructor(p: Rec) { rasterCalls.push(p); } },
  ParticleLayer: class { constructor(p: Rec) { particleCalls.push(p); } },
  ContourLayer: class { constructor(_p: Rec) {} },
  HighLowLayer: class { constructor(_p: Rec) {} },
  ImageType: { SCALAR: "SCALAR", VECTOR: "VECTOR" },
}));
// @deck.gl/core and @deck.gl/layers map to the same shared mock file, so this
// factory replaces BOTH — keep the shared exports (LayerExtension, for the
// BreatheExtension the raster builders attach) and only override the layer.
jest.mock("@deck.gl/layers", () => ({
  ...jest.requireActual<Record<string, unknown>>("../../test/mocks/deckgl"),
  ScatterplotLayer: class { constructor(_p: Rec) {} },
}));

import { scalarRasterLayers } from "./index";
import { DEPTH_OCCLUDE, DEPTH_PAINT } from "./depth";

const GLOBAL: [number, number, number, number] = [-180, -90, 179.75, 90];
const FRANCE: [number, number, number, number] = [-6, 41, 10, 52];

/** temp: empty-files base + two nests (coarse global icon-global, fine AROME). */
const tempVar: WeatherVariableManifest = {
  encoding: "scalar",
  units: "C",
  files: {}, // no true base
  nests: [
    { encoding: "scalar", units: "C", sourceId: "icon-global", bbox: GLOBAL, minZoom: 2, priority: 12, files: { "0": "/tex/icon" } },
    { encoding: "scalar", units: "C", sourceId: "arome", bbox: FRANCE, minZoom: 5, priority: 31, files: { "0": "/tex/arome" } },
  ],
};

const manifest: WeatherManifest = {
  model: "composite",
  run: "2026-06-30T12:00:00.000Z",
  bounds: [-180, -90, 180, 90],
  grid: { width: 1440, height: 721, res: 0.25 },
  steps: [{ validTime: "2026-06-30T12:00:00Z", fhr: 0 }],
  variables: { temp: tempVar },
};

const loaded = new Set(["/tex/icon", "/tex/arome"]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolve = (url: string): any => (loaded.has(url) ? { url } : undefined);
const inFrance = { center: [2, 47] as [number, number], zoom: 6 };

beforeEach(() => { rasterCalls.length = 0; particleCalls.length = 0; });

describe("scalarRasterLayers — nest promoted to base when no true base", () => {
  it("draws icon-global globe-wide UNDER the fine AROME nest", () => {
    const layers = scalarRasterLayers(manifest, "temp", 0, resolve, inFrance);
    expect(layers).toHaveLength(2);
    // Base = coarsest nest (icon-global), clipped to its worldwide bbox, sealing depth.
    expect(rasterCalls[0].image).toEqual({ url: "/tex/icon" });
    expect(rasterCalls[0].bounds).toEqual(GLOBAL);
    expect(rasterCalls[0].parameters).toBe(DEPTH_OCCLUDE);
    // Top = finest nest (AROME), painted over the base.
    expect(rasterCalls[1].image).toEqual({ url: "/tex/arome" });
    expect(rasterCalls[1].bounds).toEqual(FRANCE);
    expect(rasterCalls[1].parameters).toBe(DEPTH_PAINT);
  });

  it("draws icon-global once (as base) when it's the only active nest — no double", () => {
    // Zoomed out over the globe: only icon-global is active (AROME below minZoom).
    const layers = scalarRasterLayers(manifest, "temp", 0, resolve, { center: [0, 20], zoom: 3 });
    expect(layers).toHaveLength(1);
    expect(rasterCalls[0].image).toEqual({ url: "/tex/icon" });
    expect(rasterCalls[0].parameters).toBe(DEPTH_OCCLUDE);
  });

  it("falls back to the fine nest as base when icon-global's texture isn't loaded yet", () => {
    const resolveNoIcon = (url: string) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      url === "/tex/arome" ? ({ url } as any) : undefined;
    const layers = scalarRasterLayers(manifest, "temp", 0, resolveNoIcon, inFrance);
    // AROME is the only loaded nest → it becomes the (occluding) base itself, drawn once.
    expect(layers).toHaveLength(1);
    expect(rasterCalls[0].image).toEqual({ url: "/tex/arome" });
    expect(rasterCalls[0].parameters).toBe(DEPTH_OCCLUDE);
  });
});

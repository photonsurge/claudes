/**
 * Tests for the layer BUILDERS (index.ts): props → mocked GL layer instances.
 * The weatherlayers-gl / @deck.gl modules are mapped to prop-capturing mocks
 * (jest.config.cjs moduleNameMapper), so instances expose `.props` and no GL
 * context is ever touched. Complements nestBase.test.ts, which covers the
 * "no true base → promote coarsest nest" path for scalar rasters.
 */

// The shared deckgl mock has no DataFilterExtension (cityLayer needs it). NB:
// @deck.gl/extensions and @deck.gl/layers both map to the SAME mock file, so
// spread the actual mock to keep ScatterplotLayer & co intact.
jest.mock("@deck.gl/extensions", () => ({
  ...jest.requireActual("@deck.gl/extensions"),
  DataFilterExtension: class {
    opts: Record<string, unknown>;
    constructor(opts: Record<string, unknown> = {}) {
      this.opts = opts;
    }
  },
}));

import type { WeatherManifest, WeatherVariableManifest } from "@photonsurge/shared/manifest";
import { RasterLayer, ParticleLayer, ContourLayer, HighLowLayer } from "weatherlayers-gl";
import {
  vectorParticleLayer,
  windParticleLayer,
  scalarRasterLayer,
  scalarRasterLayers,
  vectorParticleLayers,
  pressureLayers,
  elevationReliefLayer,
  elevationLayers,
  cityLayer,
} from "./index";
import { DEPTH_OCCLUDE, DEPTH_TEST, DEPTH_PAINT } from "./depth";
import type { City } from "../../lib/cities";

const GLOBAL: [number, number, number, number] = [-180, -90, 180, 90];
const FRANCE: [number, number, number, number] = [-6, 41, 10, 52];

const entry = (over: Partial<WeatherVariableManifest>): WeatherVariableManifest => ({
  encoding: "scalar",
  units: "x",
  files: { "0": "u" },
  ...over,
});

const makeManifest = (variables: Record<string, WeatherVariableManifest>): WeatherManifest => ({
  model: "gfs",
  run: "2026-07-01T00:00:00.000Z",
  bounds: [-180, -90, 180, 90],
  grid: { width: 1440, height: 721, res: 0.25 },
  steps: [{ validTime: "2026-07-01T00:00:00Z", fhr: 0 }],
  variables,
});

const manifest = makeManifest({
  wind: entry({ encoding: "uv", units: "m/s", imageUnscale: [-30, 30], files: { "0": "/tex/wind0" } }),
  temp: entry({ units: "C", domain: [-40, 50], files: { "0": "/tex/temp0" } }),
  pressure: entry({
    units: "hPa",
    domain: [950, 1050],
    imageUnscale: [95000, 105000],
    files: { "0": "/tex/pres0" },
  }),
  elevation: entry({
    units: "m",
    domain: [-8000, 6000],
    imageUnscale: [-11000, 9000],
    files: { "0": "/tex/elev0" },
  }),
});

/** Resolver: every /tex/* URL is "loaded" as { url } unless excluded. */
const resolver =
  (except: string[] = []) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (url: string): any =>
    except.includes(url) ? undefined : { url };
const resolve = resolver();
const resolveNone = resolver(["/tex/wind0", "/tex/temp0", "/tex/pres0", "/tex/elev0"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const props = (l: any) => l.props as Record<string, any>;

describe("vectorParticleLayer / windParticleLayer", () => {
  it("builds a depth-tested ParticleLayer with the resolved image", () => {
    const l = windParticleLayer(manifest, 0, resolve)!;
    expect(l).toBeInstanceOf(ParticleLayer);
    expect(props(l).id).toBe("wind-0");
    expect(props(l).image).toEqual({ url: "/tex/wind0" });
    expect(props(l).imageUnscale).toEqual([-30, 30]);
    // DEPTH_TEST (not occlude): particles must not seal the depth buffer.
    expect(props(l).parameters).toBe(DEPTH_TEST);
  });

  it("forwards particle opts through to the layer props", () => {
    const l = vectorParticleLayer(manifest, "wind", 0, resolve, { numParticles: 123, opacity: 0.5 })!;
    expect(props(l).numParticles).toBe(123);
    expect(props(l).opacity).toBe(0.5);
  });

  it("returns null while the texture is still loading", () => {
    expect(windParticleLayer(manifest, 0, resolveNone)).toBeNull();
  });

  it("returns null for a missing variable or forecast hour", () => {
    expect(vectorParticleLayer(manifest, "current", 0, resolve)).toBeNull();
    expect(windParticleLayer(manifest, 3, resolve)).toBeNull();
  });
});

describe("scalarRasterLayer", () => {
  it("builds a RasterLayer that seals depth (DEPTH_OCCLUDE)", () => {
    const l = scalarRasterLayer(manifest, "temp", 0, resolve)!;
    expect(l).toBeInstanceOf(RasterLayer);
    expect(props(l).id).toBe("scalar-temp-0");
    expect(props(l).image).toEqual({ url: "/tex/temp0" });
    expect(props(l).bounds).toEqual(GLOBAL);
    expect(props(l).parameters).toBe(DEPTH_OCCLUDE);
    expect(props(l).opacity).toBe(0.7); // default
  });

  it("honours the opacity option", () => {
    const l = scalarRasterLayer(manifest, "temp", 0, resolve, { opacity: 0.3 })!;
    expect(props(l).opacity).toBe(0.3);
  });

  it("returns null for a missing variable or unloaded texture", () => {
    expect(scalarRasterLayer(manifest, "humidity", 0, resolve)).toBeNull();
    expect(scalarRasterLayer(manifest, "temp", 0, resolveNone)).toBeNull();
  });
});

describe("scalarRasterLayers (true global base + regional nest)", () => {
  const aromeNest = entry({
    units: "C",
    sourceId: "arome",
    bbox: FRANCE,
    minZoom: 5,
    priority: 31,
    resolutionDeg: 0.01,
    files: { "0": "/tex/arome0" },
  });
  const nested = makeManifest({
    temp: entry({ units: "C", domain: [-40, 50], files: { "0": "/tex/temp0" }, nests: [aromeNest] }),
  });
  const inFrance = { center: [2, 47] as [number, number], zoom: 6 };
  const zoomedOut = { center: [2, 47] as [number, number], zoom: 2 };

  it("zoomed out: the global base alone, sealing depth", () => {
    const layers = scalarRasterLayers(nested, "temp", 0, resolve, zoomedOut);
    expect(layers).toHaveLength(1);
    expect(props(layers[0]).id).toBe("scalar-temp-0");
    expect(props(layers[0]).bounds).toEqual(GLOBAL);
    expect(props(layers[0]).parameters).toBe(DEPTH_OCCLUDE);
  });

  it("over the nest: base underneath + the nest clipped to its bbox on top (DEPTH_PAINT)", () => {
    const layers = scalarRasterLayers(nested, "temp", 0, resolve, inFrance, { opacity: 0.4 });
    expect(layers).toHaveLength(2);
    // Base keeps the operator's opacity and the full-globe bounds.
    expect(props(layers[0]).id).toBe("scalar-temp-0");
    expect(props(layers[0]).opacity).toBe(0.4);
    expect(props(layers[0]).parameters).toBe(DEPTH_OCCLUDE);
    // Nest: unique id suffix, its own bbox, forced NEST opacity, paints over base.
    expect(props(layers[1]).id).toBe("scalar-temp-0-arome");
    expect(props(layers[1]).bounds).toEqual(FRANCE);
    expect(props(layers[1]).opacity).toBe(0.95);
    expect(props(layers[1]).image).toEqual({ url: "/tex/arome0" });
    expect(props(layers[1]).parameters).toBe(DEPTH_PAINT);
  });

  it("skips the nest while its texture is still loading (base only, no seam)", () => {
    const layers = scalarRasterLayers(nested, "temp", 0, resolver(["/tex/arome0"]), inFrance);
    expect(layers).toHaveLength(1);
    expect(props(layers[0]).id).toBe("scalar-temp-0");
  });

  it("a nest without sourceId falls back to its index for the id suffix", () => {
    const anon = makeManifest({
      temp: entry({
        units: "C",
        files: { "0": "/tex/temp0" },
        nests: [{ ...aromeNest, sourceId: undefined }],
      }),
    });
    const layers = scalarRasterLayers(anon, "temp", 0, resolve, inFrance);
    expect(props(layers[1]).id).toBe("scalar-temp-0-n1");
  });

  it("returns [] for an unknown variable", () => {
    expect(scalarRasterLayers(nested, "nope", 0, resolve, inFrance)).toEqual([]);
  });
});

describe("vectorParticleLayers (nest-aware wind)", () => {
  const windNest = entry({
    encoding: "uv",
    units: "m/s",
    sourceId: "arome",
    bbox: FRANCE,
    minZoom: 5,
    priority: 31,
    resolutionDeg: 0.01,
    imageUnscale: [-40, 40],
    files: { "0": "/tex/warome0" },
  });
  const nested = makeManifest({
    wind: entry({
      encoding: "uv",
      units: "m/s",
      imageUnscale: [-30, 30],
      files: { "0": "/tex/wind0" },
      nests: [windNest],
    }),
  });
  const inFrance = { center: [2, 47] as [number, number], zoom: 6 };

  it("draws the global base plus the finest nest, both depth-TESTED (never occluding)", () => {
    const layers = vectorParticleLayers(nested, "wind", 0, resolve, inFrance);
    expect(layers).toHaveLength(2);
    expect(layers[0]).toBeInstanceOf(ParticleLayer);
    expect(props(layers[0]).id).toBe("wind-0");
    expect(props(layers[0]).bounds).toEqual(GLOBAL);
    expect(props(layers[1]).id).toBe("wind-0-arome");
    expect(props(layers[1]).bounds).toEqual(FRANCE);
    expect(props(layers[1]).imageUnscale).toEqual([-40, 40]);
    for (const l of layers) expect(props(l).parameters).toBe(DEPTH_TEST);
  });

  it("base only when zoomed out or the nest texture is unloaded", () => {
    expect(vectorParticleLayers(nested, "wind", 0, resolve, { center: [2, 47], zoom: 2 })).toHaveLength(1);
    expect(vectorParticleLayers(nested, "wind", 0, resolver(["/tex/warome0"]), inFrance)).toHaveLength(1);
  });

  it("promotes the coarsest loaded nest to base when the variable has no true base", () => {
    // Mirrors nestBase.test.ts but for the PARTICLE builder, which shares the
    // promotion logic: empty-files base + worldwide coarse nest + fine nest.
    const nestOnly = makeManifest({
      wind: entry({
        encoding: "uv",
        units: "m/s",
        files: {},
        nests: [
          entry({
            encoding: "uv",
            units: "m/s",
            sourceId: "icon-global",
            bbox: GLOBAL,
            minZoom: 2,
            priority: 12,
            imageUnscale: [-30, 30],
            files: { "0": "/tex/wicon0" },
          }),
          windNest,
        ],
      }),
    });
    const layers = vectorParticleLayers(nestOnly, "wind", 0, resolve, inFrance);
    expect(layers).toHaveLength(2);
    expect(props(layers[0]).image).toEqual({ url: "/tex/wicon0" });
    expect(props(layers[0]).bounds).toEqual(GLOBAL);
    expect(props(layers[1]).image).toEqual({ url: "/tex/warome0" });

    // Only the coarse global nest active → drawn ONCE (as the promoted base).
    const wide = vectorParticleLayers(nestOnly, "wind", 0, resolve, { center: [0, 20], zoom: 3 });
    expect(wide).toHaveLength(1);
    expect(props(wide[0]).image).toEqual({ url: "/tex/wicon0" });
  });
});

describe("pressureLayers", () => {
  it("builds a depth-tested contour layer only — the H/L centres ride the label canvas", () => {
    const layers = pressureLayers(manifest, 0, resolve);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(ContourLayer);
    expect(layers.some((l) => l instanceof HighLowLayer)).toBe(false);
    expect(props(layers[0]).id).toBe("pressure-contour-0");
    expect(props(layers[0]).image).toEqual({ url: "/tex/pres0" });
    expect(props(layers[0]).parameters).toBe(DEPTH_TEST);
  });

  it("forwards isobar spacing opts to the contour layer", () => {
    const layers = pressureLayers(manifest, 0, resolve, { interval: 2, majorInterval: 10 });
    expect(props(layers[0]).interval).toBe(2);
    expect(props(layers[0]).majorInterval).toBe(10);
  });

  it("returns [] with no pressure variable or unloaded texture", () => {
    expect(pressureLayers(makeManifest({}), 0, resolve)).toEqual([]);
    expect(pressureLayers(manifest, 0, resolveNone)).toEqual([]);
  });
});

describe("elevationReliefLayer", () => {
  it("builds a full-globe occluding raster with the -relief id suffix", () => {
    const l = elevationReliefLayer(manifest, resolve)!;
    expect(l).toBeInstanceOf(RasterLayer);
    expect(props(l).id).toBe("scalar-elevation-0-relief");
    expect(props(l).bounds).toEqual(GLOBAL);
    expect(props(l).opacity).toBe(1); // default: painted relief basemap
    expect(props(l).parameters).toBe(DEPTH_OCCLUDE);
  });

  it("keeps opacity 0 (the invisible depth-only sealer), not defaulting it to 1", () => {
    const l = elevationReliefLayer(manifest, resolve, { opacity: 0 })!;
    expect(props(l).opacity).toBe(0);
  });

  it("returns null with no elevation entry or unloaded texture", () => {
    expect(elevationReliefLayer(makeManifest({}), resolve)).toBeNull();
    expect(elevationReliefLayer(manifest, resolveNone)).toBeNull();
  });
});

describe("elevationLayers", () => {
  it("builds a single depth-tested contour layer (lines only, no HighLow)", () => {
    const layers = elevationLayers(manifest, resolve);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toBeInstanceOf(ContourLayer);
    expect(props(layers[0]).id).toBe("elevation-contour");
    expect(props(layers[0]).parameters).toBe(DEPTH_TEST);
  });

  it("passes the custom line colour through", () => {
    const layers = elevationLayers(manifest, resolve, { colorMode: "custom", color: "#112233" });
    expect(props(layers[0]).color).toEqual([17, 34, 51, 255]);
    expect(props(layers[0]).palette).toBeUndefined();
  });

  it("returns [] with no elevation entry or unloaded texture", () => {
    expect(elevationLayers(makeManifest({}), resolve)).toEqual([]);
    expect(elevationLayers(manifest, resolveNone)).toEqual([]);
  });
});

describe("cityLayer", () => {
  const capital = { id: "c1", name: "London", lat: 51.5, lng: -0.1, isCapital: true } as City;
  const town = { id: "c2", name: "Slough", lat: 51.51, lng: -0.6, population: 160_000 } as City;

  it("returns one dot layer whose GPU filter range follows the camera zoom", () => {
    const [l] = cityLayer([capital, town], undefined, 5.2);
    expect(props(l).id).toBe("cities-scatter");
    expect(props(l).filterRange).toEqual([0, 5.2]);
    expect(props(l).extensions).toHaveLength(1);
    expect(props(l).pickable).toBe(false);
    expect(props(l).parameters).toBe(DEPTH_TEST);
  });

  it("filters each city by the same zoom threshold that reveals its label", () => {
    const [l] = cityLayer([capital, town]);
    expect(props(l).getFilterValue(capital)).toBe(0); // capitals always visible
    expect(props(l).getFilterValue(town)).toBe(5.6); // 100k..200k band
  });

  it("keys the night-glow update triggers to the rounded subsolar point", () => {
    const [day] = cityLayer([capital], undefined, 3);
    expect(props(day).updateTriggers).toEqual({ getRadius: "off", getFillColor: "off" });
    const [night] = cityLayer([capital], [10.04, 20.06], 3);
    expect(props(night).updateTriggers).toEqual({
      getRadius: "10.0,20.1",
      getFillColor: "10.0,20.1",
    });
  });

  it("day-side styling: gold capitals, larger dots than towns", () => {
    const [l] = cityLayer([capital, town], undefined, 8);
    expect(props(l).getFillColor(capital)).toEqual([255, 215, 0, 255]);
    expect(props(l).getFillColor(town)).toEqual([255, 255, 255, 220]);
    expect(props(l).getRadius(capital)).toBe(6);
    expect(props(l).getRadius(town)).toBe(4);
  });
});

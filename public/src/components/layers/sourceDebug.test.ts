import type { WeatherManifest, WeatherVariableManifest } from "@photonsurge/shared/manifest";

// Capture deck layer constructor args instead of building real GL layers.
const pathCalls: any[] = [];
const textCalls: any[] = [];
jest.mock("@deck.gl/layers", () => ({
  PathLayer: class { constructor(p: any) { pathCalls.push(p); } },
  TextLayer: class { constructor(p: any) { textCalls.push(p); } },
}));

import { sourceDebugLayers } from "./sourceDebug";

const GLOBAL: [number, number, number, number] = [-180, -90, 180, 90];
const UK: [number, number, number, number] = [-12, 48, 5, 61];
const FR: [number, number, number, number] = [-6, 41, 10, 52];

const tempVar: WeatherVariableManifest = {
  encoding: "scalar",
  units: "C",
  files: { "0": "/tex/base" }, // has a base
  nests: [
    { encoding: "scalar", units: "C", sourceId: "icon-eu", bbox: UK, minZoom: 3, priority: 28, files: { "0": "/tex/eu" } },
    { encoding: "scalar", units: "C", sourceId: "arome", bbox: FR, minZoom: 5, priority: 34, files: { "0": "/tex/fr" } },
  ],
};
const manifest: WeatherManifest = {
  model: "composite",
  run: "2026-07-02T12:00:00.000Z",
  bounds: GLOBAL,
  grid: { width: 100, height: 50, res: 1 },
  steps: [{ validTime: "t", fhr: 0 }],
  variables: { temp: tempVar },
};

beforeEach(() => { pathCalls.length = 0; textCalls.length = 0; });

describe("sourceDebugLayers", () => {
  it("returns nothing without a manifest or variable", () => {
    expect(sourceDebugLayers(null, "temp", { center: [0, 0], zoom: 3 })).toEqual([]);
    expect(sourceDebugLayers(manifest, null, { center: [0, 0], zoom: 3 })).toEqual([]);
  });

  it("outlines the base + each active nest and tags the finest as ACTIVE", () => {
    // Centre in France, zoomed enough for both nests → base + icon-eu + arome active.
    sourceDebugLayers(manifest, "temp", { center: [0, 50], zoom: 6 });
    const boxes = pathCalls[0].data;
    const labels = boxes.map((b: any) => b.label);
    expect(labels.some((l: string) => l.includes("(base)"))).toBe(true);
    expect(labels.some((l: string) => l.includes("icon-eu"))).toBe(true);
    // arome is finest active → the winner.
    const winner = labels.find((l: string) => l.includes("▲ ACTIVE"));
    expect(winner).toContain("arome");
    // A label layer is produced alongside the outlines.
    expect(textCalls).toHaveLength(1);
  });

  it("draws only the base box when no nest is active (zoomed out)", () => {
    sourceDebugLayers(manifest, "temp", { center: [2, 47], zoom: 1 });
    const boxes = pathCalls[0].data;
    expect(boxes).toHaveLength(1);
    expect(boxes[0].label).toContain("(base)");
  });

  it("closes each bbox ring (first vertex == last)", () => {
    sourceDebugLayers(manifest, "temp", { center: [0, 50], zoom: 6 });
    for (const b of pathCalls[0].data) {
      expect(b.path[0]).toEqual(b.path[b.path.length - 1]);
    }
  });
});

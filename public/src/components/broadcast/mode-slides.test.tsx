import { modeSlides, type ModeSlideContext } from "./mode-slides";
import { DEFAULT_THEME } from "./config";
import type { Segment } from "@photonsurge/shared/director";
import type { City } from "../../lib/cities";

const seg = (over: Record<string, unknown>): Segment =>
  ({ kind: "weather", id: "weather:x", title: "X", camera: { center: [0, 0], zoom: 3 }, ...over }) as unknown as Segment;

const ctx = (over: Partial<ModeSlideContext> = {}): ModeSlideContext => ({
  cities: [],
  cams: [],
  quakes: [],
  alerts: [],
  areaAlerts: [],
  areaQuakes: [],
  areaVolcanoes: [],
  wideCitiesHasForecast: false,
  theme: DEFAULT_THEME,
  ...over,
});

const cityAt = (lng: number, lat: number): City =>
  ({ id: "c1", name: "C", lat, lng, population: 100_000 }) as unknown as City;

const ids = (s: Segment, c: ModeSlideContext) => modeSlides(s, c).map((x) => x.id);

describe("modeSlides", () => {
  it("a plain wide shot shows only the now-viewing card", () => {
    expect(ids(seg({ kind: "weather" }), ctx())).toEqual(["onair"]);
  });

  it("a country/tour spotlight adds top-cities, and the area forecast only when it has data", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    expect(ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox }))).toEqual(["onair", "topcities"]);
    expect(ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox, wideCitiesHasForecast: true }))).toEqual([
      "onair",
      "topcities",
      "forecast",
    ]);
  });

  it("a quake shows the seismic report then the cities-near enrichment", () => {
    expect(ids(seg({ kind: "quake", quake: { mag: 6.1, depthKm: 10 } }), ctx())).toEqual(["quake", "nearby"]);
  });

  it("a quake with no quake payload falls back to just the enrichment", () => {
    expect(ids(seg({ kind: "quake" }), ctx())).toEqual(["nearby"]);
  });

  it("a non-quake targeted event (storm) shows only the cities-near enrichment", () => {
    expect(ids(seg({ kind: "storm" }), ctx())).toEqual(["nearby"]);
  });

  it("a notable track shows the track-info card", () => {
    expect(ids(seg({ kind: "flight", trackInfo: { label: "AF1" } }), ctx())).toEqual(["track"]);
  });

  it("a volcano adds its facts/nearby pages only when they carry content", () => {
    const withFacts = seg({ kind: "volcano", trackInfo: { facts: "Stratovolcano" } });
    // No nearby data → facts only.
    expect(ids(withFacts, ctx())).toEqual(["track", "volcano-facts"]);
    // A nearby city → the nearby page appears too.
    expect(ids(withFacts, ctx({ cities: [cityAt(0, 0)] }))).toEqual(["track", "volcano-facts", "volcano-nearby"]);
    // No facts and nothing nearby → just the track card.
    expect(ids(seg({ kind: "volcano", trackInfo: { label: "V" } }), ctx())).toEqual(["track"]);
  });
});

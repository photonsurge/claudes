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
  histCenter: null,
  histBbox: null,
  segmentHasLocation: false,
  hasFramedForecast: false,
  showDepth: false,
  depthCenter: null,
  manifest: null,
  activeVariable: null,
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

  it("a country spotlight adds top-cities, and the area forecast only when it has data", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    expect(ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox }))).toEqual(["onair", "topcities", "cityconditions"]);
    expect(ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox, wideCitiesHasForecast: true }))).toEqual([
      "onair",
      "topcities",
      "cityconditions",
      "forecast",
    ]);
  });

  it("every mode leads with the uniform on-air lede", () => {
    expect(ids(seg({ kind: "weather" }), ctx())[0]).toBe("onair");
    expect(ids(seg({ kind: "quake", quake: { mag: 6.1, depthKm: 10 } }), ctx())[0]).toBe("onair");
    expect(ids(seg({ kind: "storm" }), ctx())[0]).toBe("onair");
    expect(ids(seg({ kind: "flight", trackInfo: { label: "AF1" } }), ctx())[0]).toBe("onair");
  });

  it("a quake shows the lede, seismic report then the cities-near enrichment", () => {
    expect(ids(seg({ kind: "quake", quake: { mag: 6.1, depthKm: 10 } }), ctx())).toEqual(["onair", "quake", "nearby"]);
  });

  it("a quake with no quake payload falls back to the lede + enrichment", () => {
    expect(ids(seg({ kind: "quake" }), ctx())).toEqual(["onair", "nearby"]);
  });

  it("a non-quake targeted event (storm) shows the lede + cities-near enrichment", () => {
    expect(ids(seg({ kind: "storm" }), ctx())).toEqual(["onair", "nearby"]);
  });

  it("a notable track shows the lede then the track-info card", () => {
    expect(ids(seg({ kind: "flight", trackInfo: { label: "AF1" } }), ctx())).toEqual(["onair", "track"]);
  });

  it("a volcano adds its facts/nearby pages only when they carry content", () => {
    const withFacts = seg({ kind: "volcano", trackInfo: { facts: "Stratovolcano" } });
    // No nearby data → lede + facts only.
    expect(ids(withFacts, ctx())).toEqual(["onair", "track", "volcano-facts"]);
    // A nearby city → the nearby page appears too.
    expect(ids(withFacts, ctx({ cities: [cityAt(0, 0)] }))).toEqual(["onair", "track", "volcano-facts", "volcano-nearby"]);
    // No facts and nothing nearby → just the lede + track card.
    expect(ids(seg({ kind: "volcano", trackInfo: { label: "V" } }), ctx())).toEqual(["onair", "track"]);
  });

  const bbox: [number, number, number, number] = [-1, -1, 1, 1];

  it("a located wide shot folds in the AREA HISTORY (current & recent) slide", () => {
    expect(
      ids(seg({ kind: "weather" }), ctx({ segmentHasLocation: true, histCenter: [0, 0], histBbox: bbox })),
    ).toEqual(["onair", "history"]);
  });

  it("a located wide shot with framed forecast reads START → WEATHER → CURRENT & RECENT", () => {
    expect(
      ids(
        seg({ kind: "weather" }),
        ctx({ segmentHasLocation: true, histCenter: [0, 0], histBbox: bbox, hasFramedForecast: true }),
      ),
    ).toEqual(["onair", "forecast", "history"]);
  });

  it("a region spotlight folds AREA HISTORY after its cities + forecast", () => {
    expect(
      ids(
        seg({ kind: "country" }),
        ctx({
          wideCitiesBbox: bbox,
          wideCitiesHasForecast: true,
          segmentHasLocation: true,
          histCenter: [0, 0],
          histBbox: bbox,
        }),
      ),
    ).toEqual(["onair", "topcities", "cityconditions", "forecast", "history"]);
  });

  it("an ocean shot adds the sea-temp-by-depth slide", () => {
    expect(ids(seg({ kind: "ocean" }), ctx({ showDepth: true, depthCenter: [0, 0] }))).toEqual(["onair", "depth"]);
  });

  it("a summary shot with no country parked (ocean stop) shows just the rollup + stats", () => {
    expect(ids(seg({ kind: "summary" }), ctx({ roundup: { sources: [] } }))).toEqual(["onair", "roundup"]);
  });

  it("a summary parked on a country plays the full package deck in order", () => {
    const country = { countryId: "jp", name: "Japan", iso2: "JP", bbox } as unknown as ModeSlideContext["summaryCountry"];
    const alert = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { id: "a", severityRank: 3, hazard: "wind", event: "Gale", areaDesc: "Coast" },
    } as unknown as ModeSlideContext["areaAlerts"][number];
    expect(
      ids(
        seg({ kind: "summary" }),
        ctx({
          summaryCountry: country,
          wideCitiesBbox: bbox,
          wideCitiesHasForecast: true,
          areaAlerts: [alert],
          roundup: { sources: [] },
        }),
      ),
    ).toEqual(["onair", "nation", "forecast", "alerts", "topcities", "cityconditions", "roundup"]);
  });

  it("a summary country with no alerts/forecast drops those slides but keeps nation + cities", () => {
    const country = { countryId: "jp", name: "Japan", iso2: "JP", bbox } as unknown as ModeSlideContext["summaryCountry"];
    expect(
      ids(seg({ kind: "summary" }), ctx({ summaryCountry: country, wideCitiesBbox: bbox, roundup: { sources: [] } })),
    ).toEqual(["onair", "nation", "topcities", "cityconditions", "roundup"]);
  });
});

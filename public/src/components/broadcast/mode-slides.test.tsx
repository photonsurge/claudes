import { modeSlides, type ModeSlideContext } from "./mode-slides";
import { DEFAULT_THEME } from "./config";
import type { Segment } from "@photonsurge/shared/director";
import type { City } from "../../lib/cities";

const seg = (over: Record<string, unknown>): Segment =>
  ({ kind: "point", id: "point:x", title: "X", camera: { center: [0, 0], zoom: 3 }, ...over }) as unknown as Segment;

const ctx = (over: Partial<ModeSlideContext> = {}): ModeSlideContext => ({
  cities: [],
  topCities: [],
  cams: [],
  quakes: [],
  alerts: [],
  volcanoCams: [],
  volcanoMedia: [],
  volcanoEruptions: [],
  alertTimeline: [],
  alertSnapshots: [],
  alertResources: [],
  alertSeries: [],
  eventTimeline: [],
  eventSnapshots: [],
  eventResources: [],
  eventSeries: [],
  areaAlerts: [],
  areaQuakes: [],
  areaVolcanoes: [],
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

/** The framed area's biggest cities (BroadcastFrame resolves these once). */
const topCities = [
  { id: "paris", name: "Paris", lat: 48.8, lng: 2.3, population: 2_100_000 },
  { id: "lyon", name: "Lyon", lat: 45.7, lng: 4.8, population: 520_000 },
] as unknown as City[];
/** What they compose to: the overview page, then ONE REAL SLIDE PER CITY —
 *  where the card used to page through them internally on its own timer. */
const CITY_GUIDE = ["topcities", "topcities:paris", "topcities:lyon"];

const ids = (s: Segment, c: ModeSlideContext) => modeSlides(s, c).map((x) => x.id);

describe("modeSlides", () => {
  it("a plain wide shot shows only the now-viewing card", () => {
    expect(ids(seg({ kind: "point" }), ctx())).toEqual(["onair"]);
  });

  it("a country spotlight folds its place round-up in as the second slide when it has one", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    const roundup = {
      narrative: "Settled and mild across the country.",
      inputs: { topCities: [], alerts: [], volcanoes: [] },
    } as unknown as ModeSlideContext["placeRoundup"];
    expect(ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox, topCities, placeRoundup: roundup }))).toEqual([
      "onair",
      "place-roundup",
      ...CITY_GUIDE,
    ]);
    // No round-up (or an empty one) → the slide is dropped, spotlight reads as before.
    expect(ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox, topCities }))).toEqual(["onair", ...CITY_GUIDE]);
  });

  it("a region ('area') spotlight with no dossier degrades to the country spotlight deck", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    const roundup = {
      narrative: "Unsettled across the region.",
      inputs: { topCities: [], alerts: [], volcanoes: [] },
    } as unknown as ModeSlideContext["placeRoundup"];
    // No `region` dossier passed → the region-only NEXT 24H / TOP COUNTRIES slides
    // are skipped and it reads exactly like a country spotlight.
    expect(
      ids(seg({ kind: "region" }), ctx({ wideCitiesBbox: bbox, topCities, placeRoundup: roundup })),
    ).toEqual(["onair", "place-roundup", ...CITY_GUIDE]);
  });

  const regionSteps = [
    { t: "2026-07-13T00:00:00Z", condition: "sunny", temp: 20, wind: 3 },
    { t: "2026-07-13T03:00:00Z", condition: "sunny", temp: 21, wind: 4 },
  ] as unknown as ModeSlideContext["regionNearTerm"];

  const regionCountriesData = [
    { cc: "de", name: "Germany", sampleName: "Berlin", lat: 52.5, lng: 13.4, steps: regionSteps },
    { cc: "fr", name: "France", sampleName: "Paris", lat: 48.8, lng: 2.3, steps: regionSteps },
  ] as unknown as ModeSlideContext["regionCountries"];

  it("a region spotlight adds NEXT 24H + ONE SLIDE PER top country from the bundle", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    expect(
      ids(
        seg({ kind: "region" }),
        ctx({
          wideCitiesBbox: bbox,
          topCities,
          regionNearTerm: regionSteps,
          regionCountries: regionCountriesData,
        }),
      ),
    ).toEqual([
      "onair",
      "region-next24",
      "region-country-de",
      "region-country-fr",
      ...CITY_GUIDE,
    ]);
  });

  it("a region spotlight with no bundle forecasts degrades to the country spotlight deck", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    // No regionCountries / regionNearTerm (bundle didn't cover the cut) → the
    // region-only slides drop and it reads like a country spotlight.
    expect(
      ids(seg({ kind: "region" }), ctx({ wideCitiesBbox: bbox, topCities })),
    ).toEqual(["onair", ...CITY_GUIDE]);
  });

  it("a region spotlight splits the round-up: state text, then a NEXT 24H outlook slide", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    const roundup = {
      summary: "Unsettled across the region.",
      cityOutlook: [{ name: "Berlin", outlook: "Showers easing overnight." }],
      inputs: { topCities: [], alerts: [], volcanoes: [] },
    } as unknown as ModeSlideContext["placeRoundup"];
    expect(
      ids(seg({ kind: "region" }), ctx({ wideCitiesBbox: bbox, topCities, placeRoundup: roundup })),
    ).toEqual(["onair", "place-roundup", "place-roundup-24h", ...CITY_GUIDE]);
    // No per-city outlook → only the state slide, no split.
    const noOutlook = { summary: "Settled." , inputs: { topCities: [], alerts: [], volcanoes: [] } } as unknown as ModeSlideContext["placeRoundup"];
    expect(
      ids(seg({ kind: "region" }), ctx({ wideCitiesBbox: bbox, topCities, placeRoundup: noOutlook })),
    ).toEqual(["onair", "place-roundup", ...CITY_GUIDE]);
  });

  it("a country spotlight leaves city forecasts to the right-hand report", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    // Keep place context here; the right-hand report owns city forecasts.
    expect(ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox, topCities }))).toEqual(["onair", ...CITY_GUIDE]);
  });

  it("every mode leads with the uniform on-air lede", () => {
    expect(ids(seg({ kind: "point" }), ctx())[0]).toBe("onair");
    expect(ids(seg({ kind: "quake", quake: { mag: 6.1, depthKm: 10 } }), ctx())[0]).toBe("onair");
    expect(ids(seg({ kind: "storm" }), ctx())[0]).toBe("onair");
    expect(ids(seg({ kind: "flight", trackInfo: { label: "AF1" } }), ctx())[0]).toBe("onair");
  });

  it("a targeted event reads lede → [seismic] → close cities → forecast → near-event", () => {
    const bbox: [number, number, number, number] = [-1, -1, 1, 1];
    // Framed area + a rich near-event (two cities) → the full targeted deck.
    expect(
      ids(
        seg({ kind: "quake", quake: { mag: 6.1, depthKm: 10 } }),
        ctx({ histBbox: bbox, histCenter: [0, 0], hasFramedForecast: true, topCities, cities: [cityAt(0, 0), cityAt(0.1, 0.1)] }),
      ),
    ).toEqual(["onair", "quake", ...CITY_GUIDE, "cityconditions", "forecast", "nearby"]);
    // A storm (no quake payload) with a framed area but no forecast/near-event
    // content → just the lede + the close-cities pages.
    expect(ids(seg({ kind: "storm" }), ctx({ histBbox: bbox, topCities }))).toEqual([
      "onair",
      ...CITY_GUIDE,
      "cityconditions",
    ]);
  });

  it("a storm folds in the alert-timeline slide after the lede when it has beats", () => {
    const beats = [
      { at: "2026-07-12T14:00:00Z", type: "ISSUED", label: "Warning issued" },
      { at: "2026-07-12T14:17:00Z", type: "SEVERITY_CHANGED", label: "Severity raised to Severe", severityRank: 3 },
    ] as unknown as ModeSlideContext["alertTimeline"];
    expect(ids(seg({ kind: "storm" }), ctx({ alertTimeline: beats }))).toEqual(["onair", "alert-timeline"]);
    // A lone ISSUED beat doesn't earn a slide.
    const one = [{ at: "2026-07-12T14:00:00Z", type: "ISSUED", label: "Warning issued" }] as unknown as ModeSlideContext["alertTimeline"];
    expect(ids(seg({ kind: "storm" }), ctx({ alertTimeline: one }))).toEqual(["onair"]);
    // Non-storm targeted events never show it.
    expect(ids(seg({ kind: "quake", quake: { mag: 6, depthKm: 10 } }), ctx({ alertTimeline: beats }))).not.toContain(
      "alert-timeline",
    );
  });

  it("a storm folds in the alert-media slide when it has snapshots", () => {
    const snaps = [
      { id: "s1", kind: "satellite", capturedAt: "2026-07-12T15:00:00Z", observationTime: "2026-07-12T00:00:00Z", width: 1024, height: 768 },
    ] as unknown as ModeSlideContext["alertSnapshots"];
    expect(ids(seg({ kind: "storm" }), ctx({ alertSnapshots: snaps }))).toEqual(["onair", "alert-media"]);
    // No snapshots → no slide.
    expect(ids(seg({ kind: "storm" }), ctx())).toEqual(["onair"]);
  });

  it("prefers the unified event-timeline over the alert timeline once the storm is promoted", () => {
    const eventBeats = [
      { at: "2026-07-12T14:00:00Z", type: "ISSUED", label: "Warning issued" },
      { at: "2026-07-12T14:17:00Z", type: "PRODUCT_ADDED", label: "1 new Copernicus product", source: "copernicus" },
    ] as unknown as ModeSlideContext["eventTimeline"];
    const alertBeats = [
      { at: "2026-07-12T14:00:00Z", type: "ISSUED", label: "Warning issued" },
      { at: "2026-07-12T14:17:00Z", type: "SEVERITY_CHANGED", label: "Severity raised" },
    ] as unknown as ModeSlideContext["alertTimeline"];
    // Both present → the cross-source event timeline (superset) wins.
    expect(ids(seg({ kind: "storm" }), ctx({ eventTimeline: eventBeats, alertTimeline: alertBeats }))).toEqual([
      "onair",
      "event-timeline",
    ]);
    // Not promoted (event empty) → falls back to the alert timeline.
    expect(ids(seg({ kind: "storm" }), ctx({ alertTimeline: alertBeats }))).toEqual(["onair", "alert-timeline"]);
  });

  it("shows an event-media slide from cross-source products alone, else falls back to alert imagery", () => {
    const resources = [
      { id: "r1", eventId: "e1", source: "gdacs", url: "https://x/report", kind: "REPORT", rebroadcastSafe: false },
    ] as unknown as ModeSlideContext["eventResources"];
    // Resources with no snapshot still earn the event-media slide.
    expect(ids(seg({ kind: "storm" }), ctx({ eventResources: resources }))).toEqual(["onair", "event-media"]);
    // No event data but the alert has a snapshot → the alert-media slide.
    const snaps = [
      { id: "s1", kind: "satellite", capturedAt: "2026-07-12T15:00:00Z", observationTime: "2026-07-12T00:00:00Z", width: 10, height: 10 },
    ] as unknown as ModeSlideContext["alertSnapshots"];
    expect(ids(seg({ kind: "storm" }), ctx({ alertSnapshots: snaps }))).toEqual(["onair", "alert-media"]);
  });

  it("drops the sparse near-event page when it would show a single bare city", () => {
    // One curated city with no photo/blurb and no cams → the old empty
    // 'near this event' card is no longer added.
    expect(ids(seg({ kind: "storm" }), ctx({ cities: [cityAt(0, 0)] }))).toEqual(["onair"]);
    // A second nearby city makes the page worth a slide again.
    expect(ids(seg({ kind: "storm" }), ctx({ cities: [cityAt(0, 0), cityAt(0.1, 0.1)] }))).toEqual(["onair", "nearby"]);
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

  it("gives EACH volcano camera its own slide, plus satellite imagery", () => {
    const volcano = seg({ kind: "volcano", trackInfo: { label: "V" } });
    // On air we serve OUR stored copy, not the provider's URL.
    const volcanoCams = [
      { camId: "cam-1", title: "Summit", localImageUrl: "/api/volcanoes/media/m1", upstreamImageUrl: "https://example.test/cam.jpg" },
      { camId: "cam-2", title: "Thermal", localImageUrl: "/api/volcanoes/media/m2" },
    ] as ModeSlideContext["volcanoCams"];
    const volcanoMedia = [{ id: "sat-1", volcanoId: "gvp:1", source: "VOLCAT", type: "SATELLITE",
      assetRef: "sat-1", sourceUrl: "https://example.test/source", acquiredAt: new Date() }] as ModeSlideContext["volcanoMedia"];
    // Hybrid: a 2×2 overview first, then one full-size page per camera.
    expect(ids(volcano, ctx({ volcanoCams, volcanoMedia }))).toEqual([
      "onair", "track", "volcano-cams", "volcano-cam:cam-1", "volcano-cam:cam-2", "volcano-satellite",
    ]);
  });

  it("volcano cameras we hold locally lead the rotation; unrenderable ones get no slide", () => {
    const volcano = seg({ kind: "volcano", trackInfo: { label: "V" } });
    const volcanoCams = [
      { camId: "upstream-only", title: "Hot-linked", upstreamImageUrl: "https://example.test/cam.jpg" },
      { camId: "no-image", title: "Dead" }, // nothing to render → no slide at all
      { camId: "stored", title: "Ours", localImageUrl: "/api/volcanoes/media/m1" },
    ] as ModeSlideContext["volcanoCams"];
    expect(ids(volcano, ctx({ volcanoCams }))).toEqual([
      "onair", "track", "volcano-cams", "volcano-cam:stored", "volcano-cam:upstream-only",
    ]);
  });

  it("a lone volcano camera skips the overview grid (it would just duplicate the page)", () => {
    const volcano = seg({ kind: "volcano", trackInfo: { label: "V" } });
    const volcanoCams = [
      { camId: "only", title: "Summit", localImageUrl: "/api/volcanoes/media/m1" },
    ] as ModeSlideContext["volcanoCams"];
    expect(ids(volcano, ctx({ volcanoCams }))).toEqual(["onair", "track", "volcano-cam:only"]);
  });

  it("a volcano gets geology + eruption-history slides from the catalog, with no event needed", () => {
    const volcano = seg({ kind: "volcano", trackInfo: { label: "V" } });
    // Catalog facts + eruption history are present for ANY volcano — dormant,
    // never promoted, absent from this week's bulletin.
    const v = {
      id: "gvp:211060",
      name: "Etna",
      volcanoType: "Stratovolcano",
      tectonicSetting: "Subduction zone / Continental crust (> 25 km)",
      geologicalSummary: "Mount Etna, towering above Catania…",
    } as ModeSlideContext["volcano"];
    const volcanoEruptions = [
      { volcanoId: "gvp:211060", eruptionNumber: 1, confirmed: true, vei: 3, startYear: 2022, startPrecision: "year" },
    ] as ModeSlideContext["volcanoEruptions"];
    expect(ids(volcano, ctx({ volcano: v, volcanoEruptions }))).toEqual([
      "onair", "track", "volcano-geology", "volcano-eruptions",
    ]);
  });

  it("volcano geology/eruption slides self-hide before the catalog seed has run", () => {
    const volcano = seg({ kind: "volcano", trackInfo: { label: "V" } });
    expect(ids(volcano, ctx({}))).toEqual(["onair", "track"]);
  });

  const bbox: [number, number, number, number] = [-1, -1, 1, 1];

  it("a located wide shot folds in the AREA HISTORY (current & recent) slide", () => {
    expect(
      ids(seg({ kind: "point" }), ctx({ segmentHasLocation: true, histCenter: [0, 0], histBbox: bbox })),
    ).toEqual(["onair", "history"]);
  });

  it("a located wide shot with framed forecast reads START → WEATHER → CURRENT & RECENT", () => {
    expect(
      ids(
        seg({ kind: "point" }),
        ctx({ segmentHasLocation: true, histCenter: [0, 0], histBbox: bbox, hasFramedForecast: true }),
      ),
    ).toEqual(["onair", "forecast", "history"]);
  });

  it("a region spotlight folds AREA HISTORY after its city guide", () => {
    expect(
      ids(
        seg({ kind: "country" }),
        ctx({
          wideCitiesBbox: bbox,
          topCities,
          segmentHasLocation: true,
          histCenter: [0, 0],
          histBbox: bbox,
        }),
      ),
    ).toEqual(["onair", ...CITY_GUIDE, "history"]);
  });

  it("an ocean shot adds the sea-temp-by-depth slide", () => {
    expect(ids(seg({ kind: "ocean" }), ctx({ showDepth: true, depthCenter: [0, 0] }))).toEqual(["onair", "depth"]);
  });

  it("a summary shot with no country parked (ocean stop) shows just the rollup + stats", () => {
    expect(ids(seg({ kind: "global", summary: { id: "1", period: "daily", narrative: "n", generatedAt: "x" } }), ctx({ roundup: { sources: [] } }))).toEqual(["onair", "roundup"]);
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
        seg({ kind: "global", summary: { id: "1", period: "daily", narrative: "n", generatedAt: "x" } }),
        ctx({
          summaryCountry: country,
          wideCitiesBbox: bbox,
          topCities,
          areaAlerts: [alert],
          roundup: { sources: [] },
        }),
      ),
    ).toEqual(["onair", "nation", "alerts", ...CITY_GUIDE, "forecast", "roundup"]);
  });

  it("a summary country with no alerts drops that slide but keeps nation + cities + forecast", () => {
    const country = { countryId: "jp", name: "Japan", iso2: "JP", bbox } as unknown as ModeSlideContext["summaryCountry"];
    expect(
      ids(
        seg({ kind: "global", summary: { id: "1", period: "daily", narrative: "n", generatedAt: "x" } }),
        ctx({ summaryCountry: country, wideCitiesBbox: bbox, topCities, roundup: { sources: [] } }),
      ),
    ).toEqual(["onair", "nation", ...CITY_GUIDE, "forecast", "roundup"]);
  });
});

describe("modeSlides — per-channel slide prefs", () => {
  const bbox: [number, number, number, number] = [-1, -1, 1, 1];
  const spotlight = () => ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox, topCities }));

  it("the country spotlight's natural deck (baseline)", () => {
    expect(spotlight()).toEqual(["onair", ...CITY_GUIDE]);
  });

  it("slidesOff hides the listed slide — and every per-city page with it", () => {
    expect(ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox, topCities, slidesOff: ["topcities"] }))).toEqual([
      "onair",
    ]);
  });

  it("never drops the pinned on-air lede, even when listed", () => {
    expect(ids(seg({ kind: "point" }), ctx({ slidesOff: ["onair"] }))).toEqual(["onair"]);
  });

  it("slideOrder reranks the deck after the pinned lede", () => {
    expect(
      ids(seg({ kind: "country" }), ctx({ wideCitiesBbox: bbox, topCities, slideOrder: ["forecast", "topcities"] })),
    ).toEqual(["onair", ...CITY_GUIDE]);
  });
});

/**
 * The warning's own words — the CAP description/instruction that reached
 * `/admin` and never `/watch`, so a storm cut aired our title, our hazard and
 * our severity rank and no detail at all.
 */
describe("modeSlides — WARNING DETAIL", () => {
  const storm = seg({ kind: "storm", id: "storm:wmo:sa-x", title: "Extreme Rainfall" });
  const narrative = {
    headline: "Extreme Rainfall",
    description: "Heavy rainfall expected, 40-60mm in 24 hours.",
    areas: ["Asir region - Abha"],
    areaCount: 3,
    translated: false,
    categories: ["Met"],
  };

  it("leads the storm's own pages — right after the lede, ahead of the timeline", () => {
    const out = ids(storm, ctx({ alertNarrative: narrative, alertTimeline: [{ at: "t", type: "ISSUED", label: "Issued" }, { at: "t2", type: "UPDATED", label: "Updated" }] as never }));
    expect(out[0]).toBe("onair");
    expect(out[1]).toBe("alert-detail");
    expect(out.indexOf("alert-detail")).toBeLessThan(out.indexOf("alert-timeline"));
  });

  it("self-hides for a bulletin that ships no prose, and off a non-storm cut", () => {
    expect(ids(storm, ctx())).not.toContain("alert-detail");
    expect(ids(storm, ctx({ alertNarrative: { ...narrative, headline: undefined, description: undefined } }))).not.toContain("alert-detail");
    const quake = seg({ kind: "quake", id: "quake:us1", quake: { mag: 5, depthKm: 10 } });
    expect(ids(quake, ctx({ alertNarrative: narrative }))).not.toContain("alert-detail");
  });

  it("follows the channel's slide preferences like any other catalog page", () => {
    const out = ids(storm, ctx({ alertNarrative: narrative, slidesOff: ["alert-detail"] }));
    expect(out).not.toContain("alert-detail");
  });
});

/**
 * A targeted event's city guide is CONTEXT, not the story — eight per-city
 * pages crowded the event's own slides out of a shot that only has room for a
 * handful. The overview page still lists them all.
 */
describe("modeSlides — city pages are capped on a targeted event", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i}`,
    name: `City ${i}`,
    lat: 32,
    lng: 35,
    population: 1_000_000 - i,
  })) as unknown as City[];

  it("airs the overview plus at most three per-city pages on a storm", () => {
    const out = ids(seg({ kind: "storm", id: "storm:wmo:x" }), ctx({ topCities: many }));
    const pages = out.filter((id) => id.startsWith("topcities:"));
    expect(out).toContain("topcities");
    expect(pages).toEqual(["topcities:c0", "topcities:c1", "topcities:c2"]);
  });

  it("keeps the full run on a country spotlight, where the cities are the story", () => {
    const country = seg({ kind: "country", id: "country:france" });
    const out = ids(country, ctx({ topCities: many, wideCitiesBbox: [0, 0, 1, 1], segmentHasLocation: true }));
    expect(out.filter((id) => id.startsWith("topcities:"))).toHaveLength(8);
  });
});

/**
 * The CITY GUIDE and NEAR THIS EVENT both wanted per-city pages, and since the
 * guide became event-scoped they want the SAME towns — so a viewer met each one
 * twice. The guide owns the page; nearby keeps only what it didn't reach.
 */
describe("modeSlides — near-event pages don't repeat the city guide", () => {
  const rich = (id: string, name: string): City =>
    ({ id, name, lat: 32, lng: 35, population: 500_000, wikiExtract: "A city." }) as unknown as City;
  const storm = seg({ kind: "storm", id: "storm:wmo:x", camera: { center: [35, 32], zoom: 4.5 } });

  it("drops a nearby page for a city the guide is already airing", () => {
    const shared = rich("tiberias", "Tiberias");
    const out = ids(storm, ctx({ topCities: [shared], cities: [shared] }));
    expect(out).toContain("topcities:tiberias");
    expect(out.filter((id) => id.startsWith("nearby:"))).toEqual([]);
  });

  it("still gives a page to a town the guide didn't reach, capped at two", () => {
    const guide = [rich("tiberias", "Tiberias")];
    const others = ["a", "b", "c", "d"].map((k) => rich(k, `Town ${k}`));
    const out = ids(storm, ctx({ topCities: guide, cities: [...guide, ...others] }));
    expect(out.filter((id) => id.startsWith("nearby:"))).toHaveLength(2);
  });
});

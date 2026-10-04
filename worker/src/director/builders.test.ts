import {
  countryCandidate,
  regionCandidate,
  summaryCandidate,
  quakeCandidate,
  volcanoCandidate,
  stormCandidate,
  countrySubtitle,
  regionSubtitle,
} from "./builders";
import { buildCandidates } from "./candidates";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";
import { countryShot } from "@photonsurge/shared/director-countries";
import { regionShot } from "@photonsurge/shared/director-regions";
import { volcanoTrackInfo } from "@photonsurge/shared/segments";
import type { AppDb } from "@photonsurge/shared/db/index";

const cfg = (over: Partial<DirectorConfig> = {}): DirectorConfig => ({
  ...DEFAULT_DIRECTOR_CONFIG,
  ...over,
  kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, ...(over.kinds ?? {}) },
});

/** Only kinds whose subject the fake db below supplies, so pool parity checks stay focused. */
const onlyKinds = (...on: (keyof DirectorConfig["kinds"])[]): DirectorConfig["kinds"] =>
  Object.fromEntries(Object.keys(DEFAULT_DIRECTOR_CONFIG.kinds).map((k) => [k, on.includes(k as any)])) as DirectorConfig["kinds"];

/** Minimal fake DB: just the catalog reads the country/region builders make. */
function fakeDb(over: { countries?: Record<string, any>; countriesThrow?: boolean; region?: any } = {}): AppDb {
  return {
    countries: {
      get: async (countryId: string) => {
        if (over.countriesThrow) throw new Error("catalog down");
        return (over.countries ?? {})[countryId] ?? null;
      },
    },
    regions: { get: async () => over.region ?? null },
  } as unknown as AppDb;
}

const NOW = Date.parse("2026-10-04T12:00:00Z");

const alert = (over: Record<string, any> = {}) => ({
  source: "nws",
  identifier: "a1",
  maxSeverityRank: 4,
  created: new Date(NOW - 5 * 60 * 1000),
  info: [
    {
      event: "Hurricane Warning",
      area: [
        {
          areaDesc: "Gulf Coast",
          geometry: { type: "Polygon", coordinates: [[[-90, 25], [-88, 25], [-88, 27], [-90, 27], [-90, 25]]] },
        },
      ],
    },
  ],
  ...over,
});
const stormArgs = (a: any) => [a, a.info?.[0], a.info?.[0]?.area?.[0]] as const;

describe("quakeCandidate", () => {
  const quake = (over: Record<string, any> = {}) =>
    ({ quakeId: "q1", mag: 6.1, place: "Off Japan", depthKm: 10, lng: 140, lat: 38, tsunami: false, time: new Date(NOW - 60_000), ...over }) as any;

  it("frames the epicentre and scores by magnitude", () => {
    const c = quakeCandidate(quake(), cfg(), NOW);
    expect(c.segment.id).toBe("quake:q1");
    expect(c.segment.kind).toBe("quake");
    expect(c.segment.camera).toEqual({ center: [140, 38], zoom: 5 });
    expect(c.segment.quake).toEqual({ mag: 6.1, depthKm: 10 });
    expect(c.segment.tsunami).toBe(false);
    expect(c.score).toBeCloseTo(40 + 6.1 * 10);
  });

  it("is breaking only inside the recent window, and never without a time", () => {
    expect(quakeCandidate(quake(), cfg(), NOW).breaking).toBe(true);
    expect(quakeCandidate(quake({ time: new Date(NOW - 2 * 60 * 60 * 1000) }), cfg(), NOW).breaking).toBe(false);
    expect(quakeCandidate(quake({ time: undefined }), cfg(), NOW).breaking).toBe(false);
  });

  it("builds the same candidate the pool loop does", async () => {
    const q = quake();
    const db = { quakes: { list: async () => [q] } } as unknown as AppDb;
    const c = cfg({ kinds: onlyKinds("quake") });
    const pool = await buildCandidates(db, c);
    const fromPool = pool.find((p) => p.segment.id === "quake:q1")!;
    expect(quakeCandidate(q, c, Date.now())).toEqual(fromPool);
  });
});

describe("volcanoCandidate", () => {
  const volcano = (over: Record<string, any> = {}) =>
    ({ id: "gvp:1", name: "Etna", country: "Italy", status: "erupting", lng: 15, lat: 37.7, lastDate: NOW, statusChangedAt: NOW, ...over }) as any;

  it("returns null for a dormant volcano", () => {
    expect(volcanoCandidate(volcano({ status: "dormant" }), cfg(), NOW)).toBeNull();
  });

  it("frames an erupting volcano with its Track Info card", () => {
    const v = volcano({ wikiExtract: "Europe's most active volcano." });
    const c = volcanoCandidate(v, cfg(), NOW)!;
    expect(c.segment.id).toBe("volcano:gvp:1");
    expect(c.segment.title).toBe("Etna");
    expect(c.segment.camera).toEqual({ center: [15, 37.7], zoom: 5 });
    expect(c.segment.trackInfo).toEqual(volcanoTrackInfo(v));
    expect(c.score).toBeCloseTo(50 + 3 * 12);
  });

  it("is breaking only on a fresh flip to erupting", () => {
    expect(volcanoCandidate(volcano(), cfg(), NOW)!.breaking).toBe(true);
    expect(volcanoCandidate(volcano({ statusChangedAt: NOW - 7 * 60 * 60 * 1000 }), cfg(), NOW)!.breaking).toBe(false);
    expect(volcanoCandidate(volcano({ status: "unrest" }), cfg(), NOW)!.breaking).toBe(false);
  });
});

describe("stormCandidate", () => {
  it("returns null for a geocode-only alert (no polygon)", () => {
    const a = alert({ info: [{ event: "Flood Warning", area: [{ areaDesc: "Somewhere" }] }] });
    expect(stormCandidate(...stormArgs(a), cfg(), NOW)).toBeNull();
    const none = alert({ info: undefined });
    expect(stormCandidate(...stormArgs(none), cfg(), NOW)).toBeNull();
  });

  it("frames the polygon centroid with the phrasebook title and a hazard look", () => {
    const c = stormCandidate(...stormArgs(alert()), cfg(), NOW)!;
    expect(c.segment.id).toBe("storm:nws:a1");
    expect(c.segment.title).toBe("Major Hurricane");
    const [lng, lat] = c.segment.camera.center;
    expect(lng).toBeCloseTo(-89.2, 1);
    expect(lat).toBeCloseTo(25.8, 1);
    expect(c.segment.camera.zoom).toBe(4.5);
    expect(c.segment.hazard).toBeTruthy();
    expect(c.segment.patch.activeVariable).toBeTruthy();
    expect(c.score).toBe(50 + 4 * 12);
  });

  it("keys breaking off when we first saw it, and carries the country as its area", () => {
    expect(stormCandidate(...stormArgs(alert()), cfg(), NOW)!.breaking).toBe(true);
    const old = alert({ created: new Date(NOW - 2 * 60 * 60 * 1000) });
    expect(stormCandidate(...stormArgs(old), cfg(), NOW)!.breaking).toBe(false);
    const hr = alert({ source: "meteoalarm", identifier: "2.49.0.0.HR.20260829.1" });
    expect(stormCandidate(...stormArgs(hr), cfg(), NOW)!.areaKey).toBe("country:HR");
  });

  it("builds the same candidate the pool loop does", async () => {
    const a = alert();
    const db = { alerts: { list: async () => [a] } } as unknown as AppDb;
    const c = cfg({ kinds: onlyKinds("storm") });
    const pool = await buildCandidates(db, c);
    const fromPool = pool.find((p) => p.segment.id === "storm:nws:a1")!;
    expect(stormCandidate(...stormArgs(a), c, Date.now())).toEqual(fromPool);
  });
});

describe("countryCandidate", () => {
  const uk = countryShot("uk")!;

  it("airs the curated framed spotlight when there's no tour dossier", async () => {
    const c = await countryCandidate(fakeDb(), uk, cfg({ countries: [] }));
    expect(c.segment.id).toBe("country:uk");
    expect(c.segment.icon).toBe("🇬🇧");
    expect(c.segment.subtitle).toBe("Country spotlight · National weather");
    expect(c.segment.camera).toEqual({ center: uk.center, zoom: uk.zoom });
    expect(c.segment.tourStops).toBeUndefined();
    expect(c.weight).toBe(1);
  });

  it("falls back to the curated shot when the catalog read throws", async () => {
    const c = await countryCandidate(fakeDb({ countriesThrow: true }), uk, cfg());
    expect(c.segment.tourStops).toBeUndefined();
    expect(c.segment.camera.center).toEqual(uk.center);
  });

  it("tours the computed dossier and weighs a favourite heavier", async () => {
    const db = fakeDb({
      countries: {
        gb: {
          countryId: "gb",
          iso2: "GB",
          tourCentroid: [-2.0, 53.5],
          tourFrame: { center: [-2.0, 54.0], zoom: 4.4 },
          tourCities: [{ name: "London", cc: "gb", lng: -0.13, lat: 51.5, population: 8_900_000 }],
        },
      },
    });
    const c = await countryCandidate(db, uk, cfg({ countries: ["uk"] }));
    expect(c.weight).toBe(5);
    expect(c.segment.subtitle).toBe("Country tour · National weather");
    expect(c.segment.tourStops?.map((s) => s.label)).toEqual(["United Kingdom", "London"]);
    expect(c.segment.camera).toEqual({ center: [-2.0, 54.0], zoom: 4.4 });
  });
});

describe("regionCandidate", () => {
  const europe = regionShot("europe")!;

  it("tours a multi-country area's top countries", async () => {
    const db = fakeDb({
      region: {
        regionId: "europe",
        topCities: [
          { name: "London", country: "United Kingdom", cc: "gb", lng: -0.13, lat: 51.5, population: 8_900_000 },
          { name: "Paris", country: "France", cc: "fr", lng: 2.35, lat: 48.85, population: 2_100_000 },
        ],
      },
    });
    const c = await regionCandidate(db, europe, cfg({ regions: ["europe"] }));
    expect(c.segment.id).toBe("region:europe");
    expect(c.segment.subtitle).toBe("Area tour · Regional weather");
    expect(c.segment.tourStops?.map((s) => s.iso2)).toEqual(["GB", "FR"]);
    expect(c.weight).toBe(5);
  });

  it("airs one framed spotlight when the area has no cached cities", async () => {
    const c = await regionCandidate(fakeDb(), europe, cfg({ regions: [] }));
    expect(c.segment.subtitle).toBe("Region spotlight · Regional weather");
    expect(c.segment.tourStops).toBeUndefined();
    expect(c.segment.camera).toEqual({ center: europe.center, zoom: europe.zoom });
    expect(c.weight).toBe(1);
  });
});

describe("summaryCandidate", () => {
  const doc = (over: Record<string, any> = {}) =>
    ({
      id: "sum1",
      period: "12h",
      narrativeStatus: "ok",
      narrative: "Severe storms are impacting the Gulf Coast while a strong quake rattled Japan.",
      generatedAt: new Date(NOW),
      hotspots: [{ label: "Gulf Coast", hazards: ["storm"], count: 3, lng: -89, lat: 26, maxSeverity: 4 }],
      topEvents: [
        { title: "M6.1 Off Japan", hazard: "quake", lng: 140, lat: 38, severity: 3 },
        { title: "Unplaced", hazard: "flood" },
      ],
      ...over,
    }) as any;

  it("returns null without a usable narrative", () => {
    expect(summaryCandidate(doc({ narrativeStatus: "failed" }), "12h", cfg())).toBeNull();
    expect(summaryCandidate(doc({ narrative: "   " }), "12h", cfg())).toBeNull();
  });

  it("rides a global spin keyed by the doc, touring hotspots then placed top events", () => {
    const c = summaryCandidate(doc(), "12h", cfg())!;
    expect(c.segment.id).toBe("global:sum1");
    expect(c.segment.kind).toBe("global");
    expect(c.segment.title).toBe("Global Round-Up");
    expect(c.segment.subtitle).toBe("12-hour round-up");
    expect(c.segment.summary?.period).toBe("12h");
    expect(c.segment.summary?.generatedAt).toBe(new Date(NOW).toISOString());
    expect(c.segment.summary?.stops.map((s) => s.label)).toEqual(["Gulf Coast", "M6.1 Off Japan"]);
    expect(c.segment.summary?.stops[0].subtitle).toBe("storm · 3 events");
    expect(c.score).toBe(8);
  });
});

describe("tour / spotlight subtitles", () => {
  it("names a toured shot a tour and an untoured one a spotlight", () => {
    expect(countrySubtitle(true)).toBe("Country tour · National weather");
    expect(countrySubtitle(false)).toBe("Country spotlight · National weather");
    expect(regionSubtitle(true)).toBe("Area tour · Regional weather");
    expect(regionSubtitle(false)).toBe("Region spotlight · Regional weather");
  });
});

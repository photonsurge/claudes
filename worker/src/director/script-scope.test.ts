import { inBbox, resolveScope, pointFilter, scopeAlerts, scopeQuakes, scopeVolcanoes } from "./script-scope";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";
import type { AppDb } from "@photonsurge/shared/db/index";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const cfg = (over: Partial<DirectorConfig> = {}): DirectorConfig => ({ ...DEFAULT_DIRECTOR_CONFIG, ...over });

const square = (w: number, s: number, e: number, n: number) => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

/** Japan-ish: polygon 130–142E, bbox reaching offshore to 146E and west over Korea. */
const JP = { countryId: "jp", iso2: "JP", name: "Japan", bbox: [125, 24, 146, 46], geometry: square(130, 31, 142, 45) };
const KR = { countryId: "kr", iso2: "KR", name: "South Korea", bbox: [126, 34, 129.5, 38.5], geometry: square(126, 34, 129.5, 38.5) };
/** A MultiPolygon country whose whole bbox wraps the planet, like the US with the Aleutians. */
const US = {
  countryId: "us",
  iso2: "US",
  name: "United States",
  bbox: [-180, 18, 180, 72],
  geometry: { type: "MultiPolygon", coordinates: [square(-125, 25, -67, 49).coordinates, square(172, 51, 180, 53).coordinates] },
};

const alertAt = (id: string, cc: string, lng: number, lat: number, over: Record<string, any> = {}) => ({
  id,
  source: "meteoalarm",
  identifier: `2.49.0.${cc}.${id}`,
  active: true,
  maxSeverityRank: 3,
  info: [{ event: "Wind Warning", area: [{ areaDesc: "Somewhere", geometry: square(lng - 0.5, lat - 0.5, lng + 0.5, lat + 0.5) }] }],
  ...over,
});

const quake = (quakeId: string, lng: number, lat: number, over: Record<string, any> = {}) => ({
  quakeId,
  mag: 5.5,
  place: quakeId,
  depthKm: 10,
  lng,
  lat,
  time: new Date(NOW - 60 * 60 * 1000),
  ...over,
});

const volcano = (id: string, lng: number, lat: number, status = "erupting") => ({
  id,
  name: id,
  lng,
  lat,
  status,
  firstDate: NOW,
  lastDate: NOW,
  statusChangedAt: NOW,
});

interface Fake {
  countries?: any[];
  region?: any;
  alerts?: any[];
  quakes?: any[];
  volcanoes?: any[];
}

/** A fake db whose list() calls honour the filters the real repos apply server-side. */
function fakeDb(f: Fake = {}) {
  const calls: Record<string, any[]> = { alerts: [], quakes: [] };
  const db = {
    countries: {
      list: async () => f.countries ?? [],
      get: async (id: string) => (f.countries ?? []).find((c) => c.countryId === id) ?? null,
    },
    regions: { get: async () => f.region ?? null },
    alerts: {
      list: async (opts: any) => {
        calls.alerts.push(opts);
        return (f.alerts ?? []).filter((a) => (!opts.activeOnly || a.active) && a.maxSeverityRank >= (opts.severityMin ?? 0));
      },
      listByIds: async (ids: string[]) => (f.alerts ?? []).filter((a) => ids.includes(a.id)),
    },
    quakes: {
      list: async (opts: any) => {
        calls.quakes.push(opts);
        return (f.quakes ?? []).filter((q) => q.mag >= opts.minMag && q.time.getTime() >= opts.sinceMs);
      },
    },
    volcanoes: { list: async (opts: any) => (f.volcanoes ?? []).filter((v) => v.status === opts.status) },
  };
  return { db: db as unknown as AppDb, calls };
}

describe("inBbox", () => {
  it("tests a plain box", () => {
    expect(inBbox(10, 10, [0, 0, 20, 20])).toBe(true);
    expect(inBbox(25, 10, [0, 0, 20, 20])).toBe(false);
    expect(inBbox(10, 25, [0, 0, 20, 20])).toBe(false);
  });

  it("handles a box extended past +180 and one wrapping west > east", () => {
    expect(inBbox(-170, 0, [120, -60, 260, 60])).toBe(true);
    expect(inBbox(-90, 0, [120, -60, 260, 60])).toBe(false);
    expect(inBbox(-175, 0, [170, -10, -170, 10])).toBe(true);
    expect(inBbox(0, 0, [170, -10, -170, 10])).toBe(false);
  });

  it("holds everything in a 360° box", () => {
    expect(inBbox(0, 30, [-180, 18, 180, 72])).toBe(true);
  });
});

describe("resolveScope", () => {
  it("rejects unknown ids", async () => {
    const { db } = fakeDb();
    await expect(resolveScope(db, { type: "country", id: "atlantis" })).rejects.toThrow(/unknown country id "atlantis"/);
    await expect(resolveScope(db, { type: "area", id: "mordor" })).rejects.toThrow(/unknown area id "mordor"/);
  });

  it("uses the country doc's bbox offshore, unless it wraps — then the curated mainland box", async () => {
    const jp = await resolveScope(fakeDb({ countries: [JP, KR] }).db, { type: "country", id: "japan" });
    expect(jp.type === "country" && jp.offshoreBbox).toEqual(JP.bbox);
    const us = await resolveScope(fakeDb({ countries: [US] }).db, { type: "country", id: "usa" });
    expect(us.type === "country" && us.offshoreBbox).toEqual([-125, 24, -66, 49.5]);
  });

  it("unions an area's curated members with the Region doc's countries", async () => {
    const rs = await resolveScope(fakeDb({ region: { countries: [{ cc: "MN" }] } }).db, { type: "area", id: "east_asia" });
    expect(rs.type === "area" && [...rs.members].sort()).toEqual(["cn", "jp", "kp", "kr", "mn", "tw"]);
  });

  it("resolves a continent's members from the Country catalog", async () => {
    const rs = await resolveScope(fakeDb({ countries: [{ iso2: "FR", continent: "Europe" }, { iso2: "JP", continent: "Asia" }] }).db, {
      type: "area",
      id: "europe",
    });
    expect(rs.type === "area" && [...rs.members]).toEqual(["fr"]);
  });
});

describe("pointFilter (country)", () => {
  it("takes inside the polygon, offshore in the bbox, and not another country's land", async () => {
    const rs = await resolveScope(fakeDb({ countries: [JP, KR] }).db, { type: "country", id: "japan" });
    const inScope = pointFilter(rs);
    expect(inScope(139, 36)).toBe(true); // on land
    expect(inScope(144, 40)).toBe(true); // offshore, inside Japan's bbox
    expect(inScope(127, 36)).toBe(false); // inside Japan's bbox but on Korean land
    expect(inScope(100, 10)).toBe(false); // nowhere near
  });

  it("tests a wrapping MultiPolygon part by part", async () => {
    const rs = await resolveScope(fakeDb({ countries: [US] }).db, { type: "country", id: "usa" });
    const inScope = pointFilter(rs);
    expect(inScope(175, 52)).toBe(true); // the Aleutian part
    expect(inScope(160, 30)).toBe(false); // open Pacific inside the wrapped bbox
  });

  it("falls back to the curated bbox when the catalog has no doc", async () => {
    const rs = await resolveScope(fakeDb().db, { type: "country", id: "japan" });
    const inScope = pointFilter(rs);
    expect(inScope(139, 36)).toBe(true);
    expect(inScope(128, 36)).toBe(false);
  });
});

describe("scopeAlerts", () => {
  const alerts = [
    alertAt("a1", "JP", 139, 36),
    alertAt("a2", "KR", 127, 36),
    alertAt("a3", "FR", 2, 47),
    alertAt("low", "JP", 139, 36, { maxSeverityRank: 1 }),
    alertAt("gone", "JP", 139, 36, { active: false }),
    alertAt("geo", "JP", 139, 36, { info: [{ event: "Wind Warning", area: [{ areaDesc: "Codes only", geometry: null }] }] }),
  ];

  it("country: decoded country only, active, at or above the threshold, with a polygon", async () => {
    const { db, calls } = fakeDb({ alerts });
    const rs = await resolveScope(db, { type: "country", id: "japan" });
    const out = await scopeAlerts(db, cfg({ minAlertSeverity: 2 }), rs);
    expect(out.map((a) => a.id)).toEqual(["a1"]);
    expect(calls.alerts[0]).toMatchObject({ activeOnly: true, severityMin: 2, omitCoordinates: true });
  });

  it("area: any member country", async () => {
    const { db } = fakeDb({ alerts });
    const rs = await resolveScope(db, { type: "area", id: "east_asia" });
    expect((await scopeAlerts(db, cfg({ minAlertSeverity: 2 }), rs)).map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("area band: a member country AND inside the band's bbox", async () => {
    const us = [alertAt("west", "US", -120, 40), alertAt("east", "US", -75, 40)];
    const { db } = fakeDb({ alerts: us });
    const rs = await resolveScope(db, { type: "area", id: "us_west" });
    expect((await scopeAlerts(db, cfg({ minAlertSeverity: 2 }), rs)).map((a) => a.id)).toEqual(["west"]);
  });

  it("globe: every framable alert", async () => {
    const { db } = fakeDb({ alerts });
    const out = await scopeAlerts(db, cfg({ minAlertSeverity: 2 }), { type: "globe" });
    expect(out.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
  });
});

describe("scopeQuakes", () => {
  const quakes = [
    quake("land", 139, 36),
    quake("offshore", 144, 40),
    quake("korea", 127, 36),
    quake("far", 100, 10),
    quake("small", 139, 36, { mag: 3 }),
    quake("old", 139, 36, { time: new Date(NOW - 72 * 60 * 60 * 1000) }),
  ];

  it("country: polygon or offshore, inside the live window, at or above minQuakeMag", async () => {
    const { db, calls } = fakeDb({ countries: [JP, KR], quakes });
    const rs = await resolveScope(db, { type: "country", id: "japan" });
    const out = await scopeQuakes(db, cfg({ minQuakeMag: 4.5 }), rs, NOW);
    expect(out.map((q) => q.quakeId)).toEqual(["land", "offshore"]);
    expect(calls.quakes[0]).toMatchObject({ minMag: 4.5, limit: 0 });
  });

  it("area: inside the region bbox; globe: everything", async () => {
    const { db } = fakeDb({ quakes, region: { bbox: [120, 30, 150, 50] } });
    const rs = await resolveScope(db, { type: "area", id: "east_asia" });
    expect((await scopeQuakes(db, cfg(), rs, NOW)).map((q) => q.quakeId)).toEqual(["land", "offshore", "korea"]);
    expect((await scopeQuakes(db, cfg(), { type: "globe" }, NOW)).map((q) => q.quakeId)).toEqual(["land", "offshore", "korea", "far"]);
  });
});

describe("scopeVolcanoes", () => {
  it("erupting or unrest only, by the same geographic test", async () => {
    const volcanoes = [
      volcano("sakurajima", 139, 36),
      volcano("offshore", 144, 40, "unrest"),
      volcano("baekdu", 127, 36),
      volcano("sleeping", 139, 37, "dormant"),
    ];
    const { db } = fakeDb({ countries: [JP, KR], volcanoes });
    const rs = await resolveScope(db, { type: "country", id: "japan" });
    expect((await scopeVolcanoes(db, rs)).map((v) => v.id).sort()).toEqual(["offshore", "sakurajima"]);
    expect((await scopeVolcanoes(db, { type: "globe" })).map((v) => v.id).sort()).toEqual(["baekdu", "offshore", "sakurajima"]);
  });
});

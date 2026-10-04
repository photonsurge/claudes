import {
  buildLineup,
  pickEvents,
  lineupTitle,
  roundupText,
  roundupReadMs,
  tourFit,
  CLOSE_MS,
  MIN_TOUR_DWELL_MS,
  OPENER_BUDGET_SHARE,
  type EventPick,
} from "./script-template";
import { summaryTourHoldMs } from "./builders";
import {
  DEFAULT_DIRECTOR_CONFIG,
  DEFAULT_QUAKE_HOLD_SECONDS,
  DEFAULT_STORM_HOLD_SECONDS,
  DEFAULT_VOLCANO_HOLD_SECONDS,
  type DirectorConfig,
} from "@photonsurge/shared/director";
import {
  MAX_CLIP_MS,
  TARGET_WORLD_ROUNDUP,
  TARGET_WORLD_SPIN,
  scriptDurationMs,
  type ShortInclude,
} from "@photonsurge/shared/short-script";
import type { AppDb } from "@photonsurge/shared/db/index";
import { sanitizeShortFormat } from "@photonsurge/shared/short-format";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const TRANSITION_MS = 4_000;
/** The shortest a scripted tour stop can be: flight + MIN_TOUR_DWELL_MS. */
const MIN_STOP_MS = TRANSITION_MS + 8_000;
const BUDGET = 75_000;

const all = <T extends object>(o: T, s: number) => Object.fromEntries(Object.keys(o).map((k) => [k, s])) as any;

/** Every event holds `eventSec` so budget arithmetic is easy to read. */
const cfg = (eventSec = 13, over: Partial<DirectorConfig> = {}): DirectorConfig => ({
  ...DEFAULT_DIRECTOR_CONFIG,
  stormHoldSeconds: all(DEFAULT_STORM_HOLD_SECONDS, eventSec),
  quakeHoldSeconds: all(DEFAULT_QUAKE_HOLD_SECONDS, eventSec),
  volcanoHoldSeconds: all(DEFAULT_VOLCANO_HOLD_SECONDS, eventSec),
  minAlertSeverity: 2,
  minQuakeMag: 4.5,
  ...over,
});

const ALERTS: ShortInclude = { alerts: true, quakes: false, volcanoes: false };
const EVERYTHING: ShortInclude = { alerts: true, quakes: true, volcanoes: true };

const square = (w: number, s: number, e: number, n: number) => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

/** Japan with a 5-stop tour (centroid + 4 cities). */
const JP = {
  countryId: "jp",
  iso2: "JP",
  name: "Japan",
  bbox: [125, 24, 146, 46],
  geometry: square(130, 31, 142, 45),
  tourCentroid: [138, 37],
  tourFrame: { center: [138, 37], zoom: 4.2 },
  tourCities: ["Tokyo", "Osaka", "Sapporo", "Fukuoka"].map((name, i) => ({ name, lng: 135 + i, lat: 35 + i })),
};

let seq = 0;
const alertAt = (cc: string, lng: number, lat: number, over: Record<string, any> = {}) => {
  const id = `al${++seq}`;
  return {
    id,
    source: "meteoalarm",
    identifier: `2.49.0.${cc}.${id}`,
    active: true,
    maxSeverityRank: 3,
    created: new Date(NOW - 3 * 60 * 60 * 1000),
    info: [{ event: "Wind Warning", area: [{ areaDesc: id, geometry: square(lng - 0.5, lat - 0.5, lng + 0.5, lat + 0.5) }] }],
    ...over,
  };
};
const quake = (quakeId: string, lng: number, lat: number, mag = 5.5) => ({
  quakeId,
  mag,
  place: quakeId,
  depthKm: 10,
  lng,
  lat,
  time: new Date(NOW - 60 * 60 * 1000),
});
const volcano = (id: string, lng: number, lat: number) => ({
  id,
  name: id,
  lng,
  lat,
  status: "erupting",
  firstDate: NOW,
  lastDate: NOW,
  statusChangedAt: NOW - 30 * 24 * 60 * 60 * 1000,
});

/** A place round-up whose on-air text is `chars` long. */
const roundupOf = (chars: number) => ({ placeId: "x", summary: "x".repeat(chars), narrative: "", inputs: {} });

const worldSummary = (over: Record<string, any> = {}) => ({
  id: "sum1",
  period: "hourly",
  narrative: "word ".repeat(200).trim(),
  narrativeStatus: "ok",
  generatedAt: new Date(NOW - 60 * 60 * 1000),
  hotspots: [1, 2, 3].map((i) => ({ label: `H${i}`, hazards: ["wind"], count: 1, lng: i * 10, lat: 0, maxSeverity: 3 })),
  topEvents: [],
  stats: {},
  sources: [],
  ...over,
});

interface Fake {
  countries?: any[];
  region?: any;
  alerts?: any[];
  quakes?: any[];
  volcanoes?: any[];
  countryRoundups?: Record<string, any>;
  regionRoundups?: Record<string, any>;
  summaries?: Record<string, any>;
}

function fakeDb(f: Fake = {}): AppDb {
  return {
    countries: {
      list: async () => f.countries ?? [],
      get: async (id: string) => (f.countries ?? []).find((c) => c.countryId === id) ?? null,
    },
    regions: { get: async () => f.region ?? null },
    alerts: {
      list: async (opts: any) =>
        (f.alerts ?? [])
          .filter((a) => a.active && a.maxSeverityRank >= opts.severityMin)
          .sort((a, b) => b.maxSeverityRank - a.maxSeverityRank),
      listByIds: async (ids: string[]) => (f.alerts ?? []).filter((a) => ids.includes(a.id)),
    },
    quakes: { list: async (o: any) => (f.quakes ?? []).filter((q) => q.mag >= o.minMag && q.time.getTime() >= o.sinceMs) },
    volcanoes: { list: async (o: any) => (f.volcanoes ?? []).filter((v) => v.status === o.status) },
    countryRoundups: { latestForPlace: async (id: string) => f.countryRoundups?.[id] ?? null },
    regionRoundups: { latestForPlace: async (id: string) => f.regionRoundups?.[id] ?? null },
    eventSummaries: { latest: async (p: string) => f.summaries?.[p] ?? null },
  } as unknown as AppDb;
}

const japan = { type: "country" as const, id: "japan" };
const ids = (clips: { target: string }[]) => clips.map((c) => c.target);

describe("round-up only (the default)", () => {
  it("is the default with no include: opener + close, titled as a round-up", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(450) } });
    const { title, clips } = await buildLineup(db, cfg(), { scope: japan, now: NOW });
    expect(title).toBe("Japan round-up");
    expect(ids(clips)).toEqual(["country:japan", "country:japan"]);
    expect(clips[0].leadSlide).toBe("roundup");
  });

  it("sizes the country opener by read time and paces the whole tour across it", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(1500) } }); // 100 s at 15 cps
    const [opener, close] = (await buildLineup(db, cfg(), { scope: japan, now: NOW })).clips;
    expect(opener.durationMs).toBe(100_000);
    // All 5 stops fit at ≥ 12 s each; spread evenly: 20 s a stop, 16 s of it on the ground.
    expect(opener).toMatchObject({ maxStops: 5, tourDwellMs: 16_000 });
    expect(opener.label).toEqual({ title: "Japan", subtitle: "Country tour · National weather", icon: "🇯🇵" });
    expect(close).toMatchObject({ target: "country:japan", maxStops: 0, durationMs: CLOSE_MS });
    expect(close.tourDwellMs).toBeUndefined();
    // The close airs as one framed view, and its label says so.
    expect(close.label.subtitle).toBe("Country spotlight · National weather");
  });

  it("a ~60 s round-up tours several stops, not one city", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(900) } }); // 60 s
    const [opener] = (await buildLineup(db, cfg(), { scope: japan, now: NOW })).clips;
    expect(opener.durationMs).toBe(60_000);
    expect(opener.maxStops).toBe(5); // floor(60 / 12) = 5, all of Japan's stops
    expect(opener.tourDwellMs).toBe(60_000 / 5 - TRANSITION_MS);
    // The stops really fill the clip: flights + dwells add up to it.
    expect(opener.maxStops! * (TRANSITION_MS + opener.tourDwellMs!)).toBe(60_000);
  });

  it("a short round-up keeps only the stops that fit at the minimum dwell", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(450) } }); // 30 s
    const [opener] = (await buildLineup(db, cfg(), { scope: japan, now: NOW })).clips;
    expect(opener).toMatchObject({ durationMs: 30_000, maxStops: 2, tourDwellMs: 11_000 }); // floor(30 / 12)
  });

  it("reads the round-up at the scene's pace", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(900) } });
    const slow = (await buildLineup(db, cfg(), { scope: japan, readCps: 10, now: NOW })).clips[0];
    expect(slow.durationMs).toBe(90_000);
    const clamped = (await buildLineup(db, cfg(), { scope: japan, readCps: 1_000, now: NOW })).clips[0];
    expect(clamped.durationMs).toBe(Math.round((900 / 24) * 1000)); // READ_CPS_MAX
  });

  it("never truncates a round-up longer than the budget, only at MAX_CLIP_MS", async () => {
    const long = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(1500) } });
    const { clips } = await buildLineup(long, cfg(), { scope: japan, budgetMs: 30_000, now: NOW });
    expect(clips[0].durationMs).toBe(100_000);
    const huge = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(15 * 700) } });
    expect((await buildLineup(huge, cfg(), { scope: japan, now: NOW })).clips[0].durationMs).toBe(MAX_CLIP_MS);
  });

  it("is an error when the place has no round-up, or one with nothing to read", async () => {
    await expect(buildLineup(fakeDb({ countries: [JP] }), cfg(), { scope: japan, now: NOW })).rejects.toThrow(
      /No usable round-up for Japan.*\/admin\/place-roundups/,
    );
    const empty = fakeDb({ countries: [JP], countryRoundups: { jp: { summary: " ", narrative: "", inputs: { alerts: [1] } } } });
    await expect(buildLineup(empty, cfg(), { scope: japan, now: NOW })).rejects.toThrow(/No usable round-up/);
    await expect(buildLineup(fakeDb(), cfg(), { scope: { type: "area", id: "europe" }, now: NOW })).rejects.toThrow(
      /No usable round-up for Europe.*\/admin\/place-roundups/,
    );
  });

  it("area: region tour opener led by the region round-up", async () => {
    const region = {
      topCities: [
        { name: "Paris", cc: "fr", country: "France", lng: 2, lat: 48, population: 9 },
        { name: "Berlin", cc: "de", country: "Germany", lng: 13, lat: 52, population: 4 },
      ],
    };
    const db = fakeDb({ region, regionRoundups: { europe: roundupOf(900) } }); // 60 s
    const { title, clips } = await buildLineup(db, cfg(), { scope: { type: "area", id: "europe" }, now: NOW });
    expect(title).toBe("Europe round-up");
    // Two countries to tour, both fit: 30 s a stop.
    expect(clips[0]).toMatchObject({ target: "region:europe", leadSlide: "roundup", durationMs: 60_000, maxStops: 2, tourDwellMs: 26_000 });
    expect(clips[0].label.subtitle).toBe("Area tour · Regional weather");
    expect(clips[1]).toMatchObject({ target: "region:europe", maxStops: 0, label: { subtitle: "Region spotlight · Regional weather" } });
  });

  it("globe: the world round-up at its own hold, past the budget, then a world spin", async () => {
    const db = fakeDb({ summaries: { hourly: worldSummary() } });
    const { title, clips } = await buildLineup(db, cfg(), { scope: { type: "globe" }, now: NOW });
    const narrationMs = Math.round((200 / 170) * 60_000);
    const hold = summaryTourHoldMs(3, 4_000, narrationMs, 17_000);
    expect(hold).toBeGreaterThan(BUDGET);
    expect(title).toBe("World round-up");
    expect(clips[0]).toMatchObject({ target: TARGET_WORLD_ROUNDUP, durationMs: hold, label: { title: "Global Round-Up" } });
    expect(clips[1]).toMatchObject({ target: TARGET_WORLD_SPIN, durationMs: CLOSE_MS });
  });

  it("globe: no fresh, valid world round-up is an error", async () => {
    const stale = fakeDb({ summaries: { hourly: worldSummary({ generatedAt: new Date(NOW - 4 * 60 * 60 * 1000) }) } });
    await expect(buildLineup(stale, cfg(), { scope: { type: "globe" }, now: NOW })).rejects.toThrow(/No fresh world round-up/);
    const failed = fakeDb({ summaries: { hourly: worldSummary({ narrativeStatus: "error" }) } });
    await expect(buildLineup(failed, cfg(), { scope: { type: "globe" }, now: NOW })).rejects.toThrow(/No fresh world round-up/);
  });
});

describe("several places in one video", () => {
  const region = {
    topCities: [
      { name: "Paris", cc: "fr", country: "France", lng: 2, lat: 48, population: 9 },
      { name: "Berlin", cc: "de", country: "Germany", lng: 13, lat: 52, population: 4 },
    ],
  };
  const places = (...p: [string, string][]) => ({
    type: "places" as const,
    places: p.map(([type, id]) => ({ type: type as "country" | "area", id })),
  });
  const db = () =>
    fakeDb({
      countries: [JP],
      region,
      countryRoundups: { jp: roundupOf(450) }, // 30 s
      regionRoundups: { europe: roundupOf(900), africa: roundupOf(600) }, // 60 s, 40 s
      summaries: { hourly: worldSummary() },
    });

  it("one opener per place in the given order, each its round-up's read time, closing on a world spin", async () => {
    const { title, clips, skipped } = await buildLineup(db(), cfg(), {
      scope: places(["area", "africa"], ["country", "japan"], ["area", "europe"]),
      now: NOW,
    });
    expect(ids(clips)).toEqual(["region:africa", "country:japan", "region:europe", TARGET_WORLD_SPIN]);
    expect(clips.map((c) => c.durationMs)).toEqual([40_000, 30_000, 60_000, CLOSE_MS]);
    expect(clips.slice(0, 3).every((c) => c.leadSlide === "roundup" && c.roundupDepth === "full")).toBe(true);
    expect(clips[1]).toMatchObject({ maxStops: 2, label: { title: "Japan", icon: "🇯🇵" } }); // its tour, paced into 30 s
    expect(clips[3].label.title).toBe("Global Weather");
    expect(title).toBe("Africa, Japan and Europe round-up");
    expect(skipped).toEqual([]);
  });

  it("leaves out a place with no round-up (or an unknown id) and names it", async () => {
    const { clips, skipped, title } = await buildLineup(db(), cfg(), {
      scope: places(["area", "asia"], ["country", "japan"], ["country", "atlantis"], ["area", "europe"]),
      now: NOW,
    });
    expect(ids(clips)).toEqual(["country:japan", "region:europe", TARGET_WORLD_SPIN]);
    expect(skipped).toEqual([
      { place: "area:asia", name: "Asia", reason: "no usable round-up" },
      { place: "country:atlantis", name: "atlantis", reason: expect.stringMatching(/unknown country id "atlantis"/) },
    ]);
    expect(title).toBe("Japan and Europe round-up");
  });

  it("is an error when no place has a round-up", async () => {
    await expect(
      buildLineup(db(), cfg(), { scope: places(["area", "asia"], ["area", "oceania"]), now: NOW }),
    ).rejects.toThrow(/No usable round-up for any of the 2 places \(Asia: no usable round-up; Oceania: no usable round-up\)/);
  });

  it("opens on the world round-up when the format says so; skips it, named, when none is fresh", async () => {
    const scope = places(["area", "europe"], ["country", "japan"]);
    const { clips } = await buildLineup(db(), cfg(), { scope, openWithWorld: true, now: NOW });
    expect(ids(clips)).toEqual([TARGET_WORLD_ROUNDUP, "region:europe", "country:japan", TARGET_WORLD_SPIN]);
    expect(clips[0].label.title).toBe("Global Round-Up");
    const stale = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(450) } });
    const out = await buildLineup(stale, cfg(), { scope: places(["country", "japan"]), openWithWorld: true, now: NOW });
    expect(ids(out.clips)).toEqual(["country:japan", TARGET_WORLD_SPIN]);
    expect(out.skipped).toEqual([{ place: "world", name: "World", reason: "no fresh world round-up" }]);
  });

  it("is round-up only: the include switches are ignored", async () => {
    const alerts = [alertAt("JP", 135, 35)];
    const withSwitches = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(450) }, alerts });
    const { clips } = await buildLineup(withSwitches, cfg(), { scope: places(["country", "japan"]), include: EVERYTHING, now: NOW });
    expect(ids(clips)).toEqual(["country:japan", TARGET_WORLD_SPIN]);
  });

  it("follows the format: summary depth times the summaries, the close can be off", async () => {
    const shape = sanitizeShortFormat({ id: "f", opener: { roundupDepth: "summary" }, close: { enabled: false } })!;
    const sectioned = { placeId: "jp", summary: "s".repeat(300), stateOfPlay: "p".repeat(600), inputs: {} };
    const d = fakeDb({ countries: [JP], countryRoundups: { jp: sectioned } });
    const { clips } = await buildLineup(d, cfg(), { scope: places(["country", "japan"]), shape, now: NOW });
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ durationMs: 20_000, roundupDepth: "summary" });
  });
});

describe("with events", () => {
  const jpAlerts = (n: number) => Array.from({ length: n }, (_, i) => alertAt("JP", 133 + i * 0.5, 34 + i * 0.5));

  it("holds the opener to 40% of the budget when events fill the rest", async () => {
    // Room = 75 - 6 = 69 s; the opener's 30 s share leaves 39 s = three 13 s alerts.
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(1500) }, alerts: jpAlerts(5) });
    const { clips } = await buildLineup(db, cfg(), { scope: japan, include: ALERTS, now: NOW });
    expect(clips[0].durationMs).toBe(BUDGET * OPENER_BUDGET_SHARE);
    expect(clips[0].leadSlide).toBe("roundup");
    expect(clips.slice(1, -1)).toHaveLength(3);
    expect(scriptDurationMs(clips)).toBeLessThanOrEqual(BUDGET);
  });

  it("hands unused budget back to the opener, up to its natural length", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(1500) }, alerts: jpAlerts(1) });
    const { clips } = await buildLineup(db, cfg(), { scope: japan, include: ALERTS, now: NOW });
    expect(clips.map((c) => c.durationMs)).toEqual([75_000 - 6_000 - 13_000, 13_000, 6_000]);
    const short = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(300) }, alerts: jpAlerts(1) }); // 20 s
    expect((await buildLineup(short, cfg(), { scope: japan, include: ALERTS, now: NOW })).clips[0].durationMs).toBe(20_000);
  });

  it("a quiet scope with switches on: full-length opener inside the budget, no round-up needed", async () => {
    const withRoundup = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(1500) } });
    const a = (await buildLineup(withRoundup, cfg(), { scope: japan, include: EVERYTHING, now: NOW })).clips;
    expect(a.map((c) => c.durationMs)).toEqual([69_000, 6_000]);

    // No round-up: no leadSlide; the tour takes the whole room, paced into it.
    const bare = fakeDb({ countries: [JP] });
    const b = (await buildLineup(bare, cfg(), { scope: japan, include: EVERYTHING, now: NOW })).clips;
    expect(b[0].leadSlide).toBeUndefined();
    expect(b[0]).toMatchObject({ maxStops: 5, durationMs: 69_000, tourDwellMs: Math.floor(69_000 / 5) - TRANSITION_MS });
    expect(ids(b)).toEqual(["country:japan", "country:japan"]);
  });

  it("paces the tour into the opener's share left after events", async () => {
    // Budget 250 s: room 244, share 100 → eleven 13 s alerts (143 s) fit the
    // other 144 s; the 1 s they leave goes back, so the opener is 101 s.
    const db = fakeDb({ countries: [JP], alerts: jpAlerts(14) });
    const { clips } = await buildLineup(db, cfg(), { scope: japan, include: ALERTS, budgetMs: 250_000, now: NOW });
    expect(clips[0]).toMatchObject({ durationMs: 101_000, maxStops: 5, tourDwellMs: 101_000 / 5 - TRANSITION_MS });
    expect(clips.slice(1, -1)).toHaveLength(11);
    expect(scriptDurationMs(clips)).toBeLessThanOrEqual(250_000);
  });

  it("an opener squeezed below one stop airs framed, captioned as a spotlight", async () => {
    // Budget 16 s: close 6 s leaves 10 s, no 13 s alert fits, so the opener
    // takes all 10 s (its kind hold here) — under one 12 s stop.
    const db = fakeDb({ countries: [JP], alerts: jpAlerts(5) });
    const tight = cfg(13, { kindHoldSeconds: { ...DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds, country: 10 } });
    const { clips } = await buildLineup(db, tight, { scope: japan, include: ALERTS, budgetMs: 16_000, now: NOW });
    expect(clips[0].durationMs).toBeLessThan(MIN_STOP_MS);
    expect(clips[0].maxStops).toBe(0);
    expect(clips[0].tourDwellMs).toBeUndefined();
    expect(clips[0].label.subtitle).toBe("Country spotlight · National weather");
  });

  it("a country with no tour opens on one framed shot at the kind's hold", async () => {
    const db = fakeDb({ countries: [{ ...JP, tourCities: [], tourCentroid: undefined, tourFrame: undefined }], alerts: jpAlerts(5) });
    const { clips } = await buildLineup(db, cfg(), { scope: japan, include: ALERTS, now: NOW });
    expect(clips[0].maxStops).toBeUndefined();
    expect(clips[0].durationMs).toBeGreaterThanOrEqual(12_000);
  });

  it("follows the include switches", async () => {
    const db = fakeDb({
      countries: [JP],
      alerts: jpAlerts(2),
      quakes: [quake("q1", 139, 36)],
      volcanoes: [volcano("v1", 140, 38)],
    });
    const only = async (include: ShortInclude) =>
      ids((await buildLineup(db, cfg(10), { scope: japan, include, budgetMs: 200_000, now: NOW })).clips.slice(1, -1));
    expect(await only({ alerts: false, quakes: true, volcanoes: false })).toEqual(["quake:q1"]);
    expect(await only({ alerts: false, quakes: false, volcanoes: true })).toEqual(["volcano:v1"]);
    expect((await only(ALERTS)).every((t) => t.startsWith("storm:"))).toBe(true);
  });

  it("caps alerts at three per country on area and globe scopes, not on a country", async () => {
    const alerts = [...Array.from({ length: 5 }, (_, i) => alertAt("FR", 2 + i, 46)), alertAt("JP", 139, 36)];
    const db = fakeDb({ countries: [JP], alerts });
    const globe = (await buildLineup(db, cfg(10), { scope: { type: "globe" }, include: ALERTS, budgetMs: 300_000, now: NOW })).clips;
    const storms = globe.filter((c) => c.target.startsWith("storm:"));
    expect(storms.filter((c) => c.target.includes(".FR.")).length).toBe(3);
    expect(storms.filter((c) => c.target.includes(".JP.")).length).toBe(1);

    const jp = (await buildLineup(fakeDb({ countries: [JP], alerts: jpAlerts(5) }), cfg(10), {
      scope: japan,
      include: ALERTS,
      budgetMs: 300_000,
      now: NOW,
    })).clips;
    expect(jp.filter((c) => c.target.startsWith("storm:"))).toHaveLength(5);
  });

  it("never exceeds the budget, and every clip has a unique id and a label", async () => {
    const db = fakeDb({
      countries: [JP],
      countryRoundups: { jp: roundupOf(3000) },
      alerts: jpAlerts(10),
      quakes: [quake("q1", 139, 36), quake("q2", 140, 37, 6.5)],
      volcanoes: [volcano("v1", 140, 38)],
    });
    for (const budgetMs of [20_000, 45_000, 75_000, 120_000]) {
      const { clips } = await buildLineup(db, cfg(), { scope: japan, include: EVERYTHING, budgetMs, now: NOW });
      expect(scriptDurationMs(clips)).toBeLessThanOrEqual(budgetMs);
      expect(new Set(clips.map((c) => c.id)).size).toBe(clips.length);
      for (const c of clips) expect(c.label.title).toBeTruthy();
    }
  });
});

describe("pickEvents", () => {
  const ev = (kind: EventPick["kind"], type: string, score: number, holdMs: number, capKey?: string, id = `${type}-${score}`): EventPick => ({
    kind,
    type,
    capKey,
    cand: { score, segment: { id, holdMs } as any },
  });
  const picked = (events: EventPick[], budget: number) => pickEvents(events, budget).map((e) => e.cand.segment.id);

  it("puts the best of each kind first, then the rest by score", () => {
    const events = [
      ev("alerts", "storm:wind", 98, 10),
      ev("alerts", "storm:rain", 90, 10),
      ev("quakes", "quake", 80, 10),
      ev("volcanoes", "volcano", 62, 10),
    ];
    expect(picked(events, 1_000)).toEqual(["storm:wind-98", "quake-80", "volcano-62", "storm:rain-90"]);
  });

  it("a kind appears even when outscored by every other event", () => {
    const events = [ev("alerts", "storm:wind", 98, 10), ev("alerts", "storm:rain", 97, 10), ev("quakes", "quake", 50, 10)];
    expect(picked(events, 20)).toEqual(["storm:wind-98", "quake-50"]);
  });

  it("takes one per hazard type before a second of the same type", () => {
    const events = [
      ev("alerts", "storm:wind", 98, 10),
      ev("alerts", "storm:wind", 97, 10),
      ev("alerts", "storm:rain", 70, 10),
      ev("alerts", "storm:heat", 60, 10),
    ];
    expect(picked(events, 1_000)).toEqual(["storm:wind-98", "storm:rain-70", "storm:heat-60", "storm:wind-97"]);
  });

  it("passes over an event that doesn't fit and takes a smaller one behind it", () => {
    const events = [ev("alerts", "storm:wind", 98, 10), ev("alerts", "storm:rain", 90, 30), ev("alerts", "storm:heat", 80, 15)];
    expect(picked(events, 26)).toEqual(["storm:wind-98", "storm:heat-80"]);
  });

  it("caps a capKey at three; events without one are uncapped", () => {
    const fr = [1, 2, 3, 4].map((i) => ev("alerts", `storm:t${i}`, 90 - i, 10, "country:FR"));
    const free = [1, 2, 3, 4].map((i) => ev("alerts", `storm:u${i}`, 80 - i, 10));
    const out = pickEvents([...fr, ...free], 1_000);
    expect(out.filter((e) => e.capKey === "country:FR")).toHaveLength(3);
    expect(out.filter((e) => !e.capKey)).toHaveLength(4);
  });

  it("has no count limit but the budget", () => {
    const many = Array.from({ length: 40 }, (_, i) => ev("quakes", "quake", 50 + i, 1_000));
    expect(pickEvents(many, 40_000)).toHaveLength(40);
  });
});

describe("the format's shape", () => {
  /** A format's opener/close with these overrides on the defaults. */
  const shape = (o: Record<string, unknown>) => sanitizeShortFormat({ id: "f", ...o })!;
  /** Summary 300 chars (20 s); with the rest and the joining spaces, 900 (60 s). */
  const sectioned = { placeId: "jp", summary: "s".repeat(300), stateOfPlay: "p".repeat(299), advice: "a".repeat(299), inputs: {} };

  it("summary depth times and tags only the summary; full times all of it", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: sectioned } });
    const brief = (await buildLineup(db, cfg(), { scope: japan, shape: shape({ opener: { roundupDepth: "summary" } }), now: NOW })).clips[0];
    expect(brief).toMatchObject({ durationMs: 20_000, roundupDepth: "summary", leadSlide: "roundup" });
    const full = (await buildLineup(db, cfg(), { scope: japan, now: NOW })).clips[0];
    expect(full).toMatchObject({ durationMs: 60_000, roundupDepth: "full" });
  });

  it("tour off holds one framed shot; lead off leaves the deck's order alone", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(900) } });
    const [opener] = (await buildLineup(db, cfg(), { scope: japan, shape: shape({ opener: { tour: false, leadWithRoundup: false } }), now: NOW })).clips;
    expect(opener).toMatchObject({ durationMs: 60_000, maxStops: 0 });
    expect(opener.tourDwellMs).toBeUndefined();
    expect(opener.leadSlide).toBeUndefined();
    expect(opener.label.subtitle).toBe("Country spotlight · National weather");
  });

  it("a longer minimum dwell keeps fewer stops", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(900) } }); // 60 s
    const [opener] = (await buildLineup(db, cfg(), { scope: japan, shape: shape({ opener: { minTourDwellMs: 16_000 } }), now: NOW })).clips;
    expect(opener).toMatchObject({ maxStops: 3, tourDwellMs: 16_000 }); // floor(60 / 20)
  });

  it("the close can be switched off or resized", async () => {
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(900) } });
    const off = (await buildLineup(db, cfg(), { scope: japan, shape: shape({ close: { enabled: false } }), now: NOW })).clips;
    expect(off).toHaveLength(1);
    const short = (await buildLineup(db, cfg(), { scope: japan, shape: shape({ close: { ms: 3_000 } }), now: NOW })).clips;
    expect(short[1].durationMs).toBe(3_000);
    const globe = fakeDb({ summaries: { hourly: worldSummary() } });
    expect((await buildLineup(globe, cfg(), { scope: { type: "globe" }, shape: shape({ close: { enabled: false } }), now: NOW })).clips).toHaveLength(1);
  });

  it("the opener's budget share comes from the format, and no close leaves more room", async () => {
    const alerts = Array.from({ length: 5 }, (_, i) => alertAt("JP", 133 + i * 0.5, 34 + i * 0.5));
    const db = fakeDb({ countries: [JP], countryRoundups: { jp: roundupOf(1500) }, alerts });
    // Share 0.6 of 75 s = 45 s; room 69 s leaves 24 s = one 13 s alert, the 11 s left goes back.
    const { clips } = await buildLineup(db, cfg(), { scope: japan, include: ALERTS, shape: shape({ opener: { budgetShare: 0.6 } }), now: NOW });
    expect(clips.map((c) => c.durationMs)).toEqual([56_000, 13_000, 6_000]);
    // No close: room is the whole 75 s; 30 s share leaves 45 s = three alerts.
    const open = (await buildLineup(db, cfg(), { scope: japan, include: ALERTS, shape: shape({ close: { enabled: false } }), now: NOW })).clips;
    expect(open.map((c) => c.durationMs)).toEqual([36_000, 13_000, 13_000, 13_000]);
    expect(scriptDurationMs(open)).toBe(BUDGET);
  });
});

describe("titles and round-up text", () => {
  const japanRs = { type: "country", shot: { name: "Japan" } } as any;
  it("names the place and what's in it", () => {
    const none = { alerts: false, quakes: false, volcanoes: false };
    expect(lineupTitle(japanRs, none)).toBe("Japan round-up");
    expect(lineupTitle({ type: "area", shot: { name: "Europe" } } as any, none)).toBe("Europe round-up");
    expect(lineupTitle({ type: "globe" }, none)).toBe("World round-up");
    expect(lineupTitle(japanRs, { alerts: true, quakes: true, volcanoes: false })).toBe("Japan — alerts and earthquakes");
    expect(lineupTitle({ type: "globe" }, EVERYTHING)).toBe("World — alerts, earthquakes and volcanoes");
  });

  it("reads the sections that reach air, else the narrative", () => {
    const r: any = {
      summary: "Calm.",
      stateOfPlay: "Dry.",
      advice: "Relax.",
      cityOutlook: [{ name: "Tokyo", outlook: "Sunny" }, { name: "", outlook: "dropped" }],
      narrative: "ignored",
    };
    expect(roundupText(r)).toBe("Calm. Dry. Tokyo — Sunny Relax.");
    expect(roundupText({ narrative: " Old prose " } as any)).toBe("Old prose");
    expect(roundupText(null)).toBe("");
    expect(roundupReadMs({ summary: "x".repeat(150) } as any)).toBe(10_000);
  });

  it("at summary depth reads only the summary, else the narrative", () => {
    const r: any = { summary: " Calm. ", stateOfPlay: "Dry.", cityOutlook: [{ name: "Tokyo", outlook: "Sunny" }], narrative: "ignored" };
    expect(roundupText(r, "summary")).toBe("Calm.");
    expect(roundupText({ narrative: " Old prose " } as any, "summary")).toBe("Old prose");
    expect(roundupText({ stateOfPlay: "Dry." } as any, "summary")).toBe("");
    expect(roundupReadMs({ summary: "x".repeat(150), advice: "y".repeat(150) } as any, 15, "summary")).toBe(10_000);
  });
});

describe("tourFit", () => {
  it("keeps the stops that fit at the minimum dwell and spreads them evenly", () => {
    expect(tourFit(5, 60_000, 4_000)).toEqual({ maxStops: 5, tourDwellMs: 8_000 });
    expect(tourFit(10, 60_000, 4_000)).toEqual({ maxStops: 5, tourDwellMs: 8_000 });
    expect(tourFit(3, 60_000, 4_000)).toEqual({ maxStops: 3, tourDwellMs: 16_000 });
    expect(tourFit(5, 25_000, 4_000)).toEqual({ maxStops: 2, tourDwellMs: 8_500 });
  });

  it("never paces a stop below MIN_TOUR_DWELL_MS", () => {
    for (const ms of [12_000, 37_000, 61_999, 100_000]) {
      const fit = tourFit(9, ms, 4_000);
      expect(fit.tourDwellMs!).toBeGreaterThanOrEqual(MIN_TOUR_DWELL_MS);
    }
  });

  it("is a framed shot (no dwell) when not one stop fits", () => {
    expect(tourFit(5, 11_999, 4_000)).toEqual({ maxStops: 0 });
    expect(tourFit(0, 60_000, 4_000)).toEqual({ maxStops: 0 });
  });

  it("caps a long dwell", () => {
    expect(tourFit(1, 600_000, 4_000)).toEqual({ maxStops: 1, tourDwellMs: 120_000 });
  });
});

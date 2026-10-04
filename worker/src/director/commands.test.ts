jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { DirectorCommand } from "@photonsurge/shared/director-commands";
import { applyControl, holdPaused, resolveTarget, resume, withHold } from "./commands";
import { newRunner } from "./runner";

const cfg = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, {});
const NOW = Date.UTC(2026, 9, 4, 12);
const seg = (id: string): Segment => ({
  id,
  kind: id.split(":")[0] as SegmentKind,
  title: id,
  camera: { center: [0, 0], zoom: 4 },
  patch: {},
  holdMs: 12_000,
});
const alert = {
  source: "nws",
  identifier: "a1",
  maxSeverityRank: 4,
  created: new Date(NOW).toISOString(),
  info: [{ event: "Hurricane Warning", area: [{ areaDesc: "Gulf", geometry: { type: "Polygon", coordinates: [[[-90, 25], [-88, 25], [-88, 27], [-90, 27], [-90, 25]]] } }] }],
};

function fakeDb(over: Record<string, unknown> = {}): AppDb {
  return {
    quakes: { get: async (id: string) => (id === "us1" ? { quakeId: "us1", mag: 6.2, place: "Chile", lng: -71, lat: -33, depthKm: 10, time: new Date(NOW) } : null) },
    alerts: { bySourceIdentifier: async (s: string, i: string) => (s === "nws" && i === "a1" ? alert : null) },
    volcanoes: { get: async (id: string) => (id === "gvp:1" ? { id: "gvp:1", name: "Etna", status: "erupting", lng: 15, lat: 37.7, lastDate: NOW, statusChangedAt: NOW } : null) },
    countries: { get: async () => null },
    regions: { get: async () => null },
    ...over,
  } as unknown as AppDb;
}
const builder = (pool: Candidate[]) => jest.fn(async () => pool);

describe("resolveTarget — segment ids", () => {
  const r = newRunner("s1");
  const resolve = (id: string, deps = { buildCandidates: builder([]) }) =>
    resolveTarget(fakeDb(), cfg, r, { type: "segment", id }, NOW, deps as any);

  it("builds a quake from its doc", async () => {
    const res = await resolve("quake:us1");
    expect("segment" in res && res.segment.id).toBe("quake:us1");
  });

  it("builds a storm from its source and identifier", async () => {
    const res = await resolve("storm:nws:a1");
    expect("segment" in res && res.segment.id).toBe("storm:nws:a1");
  });

  it("builds a volcano from its doc", async () => {
    const res = await resolve("volcano:gvp:1");
    expect("segment" in res && res.segment.title).toBe("Etna");
  });

  it("builds a country and an area from the catalog", async () => {
    const uk = await resolve("country:uk");
    expect("segment" in uk && uk.segment.kind).toBe("country");
    const europe = await resolve("region:europe");
    expect("segment" in europe && europe.segment.kind).toBe("region");
  });

  it("refuses an id whose subject is gone", async () => {
    expect(await resolve("quake:nope")).toEqual({ refused: "that earthquake isn't available any more" });
    expect(await resolve("storm:nws:zzz")).toEqual({ refused: "that weather warning isn't available any more" });
    expect(await resolve("country:atlantis")).toEqual({ refused: "that country isn't available any more" });
  });

  it("finds other kinds in that kind's pool, even when the channel has the kind off", async () => {
    const build = builder([{ segment: seg("flight:abc"), score: 45 }]);
    const off = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, { kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, flight: false } });
    const res = await resolveTarget(fakeDb(), off, r, { type: "segment", id: "flight:abc" }, NOW, { buildCandidates: build } as any);
    expect("segment" in res && res.segment.id).toBe("flight:abc");
    const [, cfgUsed, , opts] = build.mock.calls[0] as unknown as [unknown, typeof cfg, unknown, { kinds: string[] }];
    expect(cfgUsed.kinds.flight).toBe(true);
    expect(opts.kinds).toEqual(["flight"]);
  });
});

describe("resolveTarget — kinds", () => {
  it("picks from that kind's pool the way rotation would", async () => {
    const build = builder([{ segment: seg("quake:a"), score: 90 }]);
    const res = await resolveTarget(fakeDb(), cfg, newRunner("s1"), { type: "kind", kind: "quake" }, NOW, { buildCandidates: build } as any);
    expect("segment" in res && res.segment.id).toBe("quake:a");
    expect((build.mock.calls[0] as unknown as unknown[])[3]).toEqual({ kinds: ["quake"] });
  });

  it("refuses a kind the channel has off", async () => {
    const off = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, { kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, ship: false } });
    expect(await resolveTarget(fakeDb(), off, newRunner("s1"), { type: "kind", kind: "ship" }, NOW)).toEqual({
      refused: "notable ships are off on this channel",
    });
  });

  it("refuses when there is nothing of that kind to show", async () => {
    const res = await resolveTarget(fakeDb(), cfg, newRunner("s1"), { type: "kind", kind: "volcano" }, NOW, { buildCandidates: builder([]) } as any);
    expect(res).toEqual({ refused: "no volcano to show right now" });
  });
});

describe("withHold", () => {
  it("overrides the hold on a copy", () => {
    const s = seg("quake:a");
    expect(withHold(s, 45).holdMs).toBe(45_000);
    expect(s.holdMs).toBe(12_000);
    expect(withHold(s, undefined)).toBe(s);
  });
});

describe("control ops", () => {
  const c = (op: any): DirectorCommand & { cmd: any } => ({
    id: "c",
    sceneId: "s1",
    source: { kind: "operator", user: "op" },
    cmd: op,
    status: "queued",
    createdAt: 0,
    expiresAt: 1e15,
  });
  const running = () => ({ ...newRunner("s1"), current: seg("quake:a"), startedAt: NOW - 2000, endsAt: NOW + 10_000 });

  it("skip forces a boundary, clear asks for the queue to be dropped", () => {
    expect(applyControl(running(), c({ op: "skip" }), NOW)).toEqual({ boundary: true, clear: false });
    expect(applyControl(running(), c({ op: "clear" }), NOW)).toEqual({ boundary: false, clear: true });
  });

  it("hold extends the shot", () => {
    const r = running();
    applyControl(r, c({ op: "hold", extendS: 30 }), NOW);
    expect(r.endsAt).toBe(NOW + 40_000);
  });

  it("pause banks the time left and keeps the shot frozen", () => {
    const r = running();
    applyControl(r, c({ op: "pause" }), NOW);
    expect(r.paused).toEqual({ since: NOW, remainingMs: 10_000, until: undefined });
    expect(holdPaused(r, NOW + 60_000)).toBe(true);
    expect(r.endsAt).toBe(NOW + 70_000);
  });

  it("hold while paused adds to the banked time", () => {
    const r = running();
    applyControl(r, c({ op: "pause" }), NOW);
    applyControl(r, c({ op: "hold", extendS: 5 }), NOW);
    expect(r.paused?.remainingMs).toBe(15_000);
  });

  it("resume hands the banked time back", () => {
    const r = running();
    applyControl(r, c({ op: "pause" }), NOW);
    applyControl(r, c({ op: "resume" }), NOW + 90_000);
    expect(r.paused).toBeUndefined();
    expect(r.endsAt).toBe(NOW + 100_000);
    resume(r, NOW); // no-op when not paused
    expect(r.endsAt).toBe(NOW + 100_000);
  });

  it("a timed pause lifts itself", () => {
    const r = running();
    applyControl(r, c({ op: "pause", untilMs: NOW + 5_000 }), NOW);
    expect(holdPaused(r, NOW + 4_000)).toBe(true);
    expect(holdPaused(r, NOW + 5_000)).toBe(false);
    expect(r.paused).toBeUndefined();
    expect(r.endsAt).toBe(NOW + 15_000);
  });
});

describe("resolveTarget — places and round-ups", () => {
  const r = newRunner("s1");
  const cities = (rows: unknown[]) => ({ getAll: jest.fn(async () => ({ data: rows })) });
  const roundupDb = (over: Record<string, unknown> = {}) =>
    fakeDb({
      cities: cities([]),
      countryRoundups: { latestForPlace: jest.fn(async (id: string) => (id === "gb" ? { id: "ru1" } : null)) },
      regionRoundups: { latestForPlace: jest.fn(async () => null) },
      eventSummaries: { latest: jest.fn(async () => null) },
      ...over,
    });

  it("resolves a country or area name to the channel's own shot", async () => {
    const uk = await resolveTarget(roundupDb(), cfg, r, { type: "place", query: "Britain" }, NOW);
    expect("segment" in uk && uk.segment.id).toBe("country:uk");
    const area = await resolveTarget(roundupDb(), cfg, r, { type: "place", query: "Iberia" }, NOW);
    expect("segment" in area && area.segment.id).toBe("region:iberia");
  });

  it("falls back to the biggest matching city as a point shot", async () => {
    const db = roundupDb({ cities: cities([{ id: "c-london", name: "London", country: "United Kingdom", lng: -0.12, lat: 51.5 }]) });
    const res = await resolveTarget(db, cfg, r, { type: "place", query: "Lond" }, NOW);
    expect("segment" in res && res.segment).toMatchObject({ id: "point:c-london", kind: "point", title: "London", subtitle: "United Kingdom" });
    const [filter, opts] = (db.cities.getAll as jest.Mock).mock.calls[0];
    expect(filter).toEqual({ name: { $regex: "^Lond", $options: "i" } });
    expect(opts).toMatchObject({ limit: 5, sort: { population: -1 } });
  });

  it("escapes regex characters in a city query", async () => {
    const db = roundupDb();
    await resolveTarget(db, cfg, r, { type: "place", query: "st. (x)" }, NOW);
    expect((db.cities.getAll as jest.Mock).mock.calls[0][0].name.$regex).toBe("^st\\. \\(x\\)");
  });

  it("never looks up cities when they are not allowed", async () => {
    const db = roundupDb();
    expect(await resolveTarget(db, cfg, r, { type: "place", query: "London" }, NOW, undefined, { allowCities: false })).toEqual({
      refused: 'unknown place "London"',
    });
    expect(db.cities.getAll).not.toHaveBeenCalled();
  });

  it("airs a place's round-up with the round-up leading the deck", async () => {
    const res = await resolveTarget(roundupDb(), cfg, r, { type: "roundup", place: "uk" }, NOW);
    expect("segment" in res && res.segment).toMatchObject({ id: "country:uk", leadSlide: "roundup" });
  });

  it("refuses a round-up the place doesn't have yet, or an unknown place", async () => {
    expect(await resolveTarget(roundupDb(), cfg, r, { type: "roundup", place: "japan" }, NOW)).toEqual({ refused: "no round-up for Japan yet" });
    expect(await resolveTarget(roundupDb(), cfg, r, { type: "roundup", place: "narnia" }, NOW)).toEqual({ refused: 'unknown place "narnia"' });
  });

  it("airs the freshest world round-up for an empty place", async () => {
    const doc = (id: string, generatedAt: Date) => ({ id, period: "hourly", narrativeStatus: "ok", narrative: "Storms in the Gulf.", generatedAt, hotspots: [], topEvents: [] });
    const latest = jest.fn(async (period: string) =>
      period === "hourly" ? doc("h1", new Date(NOW - 3600_000)) : period === "daily" ? doc("d1", new Date(NOW - 60_000)) : null,
    );
    const res = await resolveTarget(roundupDb({ eventSummaries: { latest } }), cfg, r, { type: "roundup" }, NOW);
    expect("segment" in res && res.segment.id).toBe("global:d1");
    expect(await resolveTarget(roundupDb(), cfg, r, { type: "roundup" }, NOW)).toEqual({ refused: "no world round-up yet" });
  });
});

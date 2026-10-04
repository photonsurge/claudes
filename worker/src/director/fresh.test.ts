jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import type { AppDb } from "@photonsurge/shared/db/index";
import { alertEvent, createFreshEventWatch, placeRoundupEvent, quakeEvent, volcanoEvent, worldRoundupEvent } from "./fresh";

const T0 = Date.UTC(2026, 9, 4, 12);

function fakeDb() {
  const state = {
    quakes: [] as any[],
    alerts: [] as any[],
    volcanoes: [] as any[],
    countryRoundups: [] as any[],
    regionRoundups: [] as any[],
    world: null as any,
  };
  const calls = { alertsSince: [] as number[], volcanoesSince: [] as number[] };
  const db = {
    quakes: { list: jest.fn(async () => state.quakes) },
    alerts: {
      createdSince: jest.fn(async (since: number) => {
        calls.alertsSince.push(since);
        return state.alerts;
      }),
    },
    volcanoes: {
      statusChangedSince: jest.fn(async (since: number) => {
        calls.volcanoesSince.push(since);
        return state.volcanoes;
      }),
    },
    countryRoundups: { generatedSince: jest.fn(async () => state.countryRoundups) },
    regionRoundups: { generatedSince: jest.fn(async () => state.regionRoundups) },
    eventSummaries: { latest: jest.fn(async () => state.world) },
  } as unknown as AppDb;
  return { db, state, calls };
}

const quake = (id: string, mag = 6) => ({ quakeId: id, mag, place: "Chile", lng: -71, lat: -33, time: new Date(T0 - 60_000) });

describe("createFreshEventWatch", () => {
  it("treats whatever is already there at start as backlog, not breaking news", async () => {
    let now = T0;
    const { db, state } = fakeDb();
    state.quakes = [quake("old")];
    const watch = createFreshEventWatch({ now: () => now });
    await watch.poll(db);
    expect(watch.since()).toEqual([]);
    now += 5000;
    state.quakes = [quake("old"), quake("new")];
    await watch.poll(db);
    expect(watch.since().map((e) => e.key)).toEqual(["quake:new"]);
  });

  it("only asks for alerts and volcano flips after the priming poll, from the last poll's time", async () => {
    let now = T0;
    const { db, calls } = fakeDb();
    const watch = createFreshEventWatch({ now: () => now });
    await watch.poll(db);
    expect(calls.alertsSince).toEqual([]);
    now += 5000;
    await watch.poll(db);
    now += 5000;
    await watch.poll(db);
    expect(calls.alertsSince).toEqual([T0, T0 + 5000]);
    expect(calls.volcanoesSince).toEqual([T0, T0 + 5000]);
  });

  it("adds each event once, and skips dormant volcanoes", async () => {
    let now = T0;
    const { db, state } = fakeDb();
    const watch = createFreshEventWatch({ now: () => now });
    await watch.poll(db);
    state.alerts = [{ source: "nws", identifier: "a1", maxSeverityRank: 4, created: new Date(T0 + 1000), info: [{ event: "Tornado Warning" }] }];
    state.volcanoes = [
      { id: "gvp:1", name: "Etna", status: "erupting", lng: 15, lat: 37, statusChangedAt: T0 + 2000 },
      { id: "gvp:2", name: "Fuji", status: "dormant", lng: 138, lat: 35, statusChangedAt: T0 + 2000 },
    ];
    now += 5000;
    await watch.poll(db);
    await watch.poll(db);
    expect(watch.since().map((e) => e.key)).toEqual(["storm:nws:a1", `volcano:gvp:1:${T0 + 2000}`]);
  });

  it("drops ring entries older than six hours", async () => {
    let now = T0;
    const { db, state } = fakeDb();
    const watch = createFreshEventWatch({ now: () => now });
    await watch.poll(db);
    state.quakes = [quake("q")];
    now += 1000;
    await watch.poll(db);
    expect(watch.since()).toHaveLength(1);
    now = T0 + 7 * 60 * 60 * 1000;
    state.quakes = [];
    await watch.poll(db);
    expect(watch.since()).toEqual([]);
  });

  it("survives a failing source", async () => {
    let now = T0;
    const { db, state } = fakeDb();
    const watch = createFreshEventWatch({ now: () => now });
    await watch.poll(db);
    (db.alerts.createdSince as jest.Mock).mockRejectedValue(new Error("down"));
    state.quakes = [quake("q")];
    now += 1000;
    await watch.poll(db);
    expect(watch.since().map((e) => e.key)).toEqual(["quake:q"]);
  });

  it("nudge polls only once started and primed", async () => {
    const { db } = fakeDb();
    const watch = createFreshEventWatch({ now: () => T0, pollMs: 1e9 });
    watch.nudge();
    expect(db.quakes.list).not.toHaveBeenCalled();
    watch.ensureStarted(db);
    await new Promise((r) => setImmediate(r));
    const calls = (db.quakes.list as jest.Mock).mock.calls.length;
    watch.nudge();
    await new Promise((r) => setImmediate(r));
    expect((db.quakes.list as jest.Mock).mock.calls.length).toBe(calls + 1);
    watch.stop();
  });
});

describe("fresh event conversions", () => {
  it("scores and keys a quake like the pool", () => {
    expect(quakeEvent({ quakeId: "us1", mag: 6.2, place: "Chile", lng: -71, lat: -33, time: new Date(T0) })).toEqual({
      reason: "quake",
      at: T0,
      mag: 6.2,
      segmentId: "quake:us1",
      key: "quake:us1",
      score: 102,
      title: "M6.2 · Chile",
      center: [-71, -33],
    });
  });

  it("keys a warning by source and identifier, timed by when we first saw it", () => {
    const ev = alertEvent({ source: "nws", identifier: "a1", maxSeverityRank: 3, created: new Date(T0), info: [{ event: "Flood Warning", area: [{ areaDesc: "Gulf" }] }] });
    expect(ev).toMatchObject({ reason: "storm", at: T0, severityRank: 3, key: "storm:nws:a1", score: 86, title: "Flood Warning · Gulf", areaKey: "country:US" });
  });

  it("keys a volcano by its flip, so a later flip is a new event", () => {
    const a = volcanoEvent({ id: "gvp:1", name: "Etna", status: "unrest", lng: 15, lat: 37, statusChangedAt: T0 });
    const b = volcanoEvent({ id: "gvp:1", name: "Etna", status: "erupting", lng: 15, lat: 37, statusChangedAt: T0 + 1 });
    expect(a.key).not.toBe(b.key);
    expect(a.volcanoLevel).toBe("unrest");
    expect(b).toMatchObject({ volcanoLevel: "erupting", segmentId: "volcano:gvp:1", score: 86 });
  });
});

describe("round-up events", () => {
  it("turns a fresh place round-up into an event on the curated shot", () => {
    expect(placeRoundupEvent({ id: "r1", placeKind: "country", placeId: "gb", name: "United Kingdom", generatedAt: new Date(T0) })).toEqual({
      reason: "roundup",
      at: T0,
      placeKind: "country",
      placeId: "uk",
      segmentId: "country:uk",
      key: "roundup:r1",
      score: 8,
      title: "United Kingdom round-up",
    });
    expect(placeRoundupEvent({ id: "r2", placeKind: "region", placeId: "iberia", name: "Iberia", generatedAt: T0 })?.segmentId).toBe("region:iberia");
  });

  it("drops a round-up for a place the director can't air", () => {
    expect(placeRoundupEvent({ id: "r3", placeKind: "country", placeId: "zz", name: "Nowhere", generatedAt: T0 })).toBeNull();
  });

  it("keys a world round-up to its global spin", () => {
    expect(worldRoundupEvent({ id: "w1", generatedAt: new Date(T0) })).toMatchObject({ placeKind: "world", segmentId: "global:w1", key: "roundup:w1" });
  });

  it("the watch picks up new round-ups with a narrative, and a newer world round-up", async () => {
    let now = T0;
    const { db, state } = fakeDb();
    const watch = createFreshEventWatch({ now: () => now });
    await watch.poll(db);
    state.countryRoundups = [
      { id: "ok", placeKind: "country", placeId: "gb", name: "UK", generatedAt: new Date(T0 + 1), narrativeStatus: "ok" },
      { id: "skipped", placeKind: "country", placeId: "jp", name: "Japan", generatedAt: new Date(T0 + 1), narrativeStatus: "skipped" },
    ];
    state.world = { id: "w2", narrativeStatus: "ok", generatedAt: new Date(T0 + 2) };
    now += 5000;
    await watch.poll(db);
    expect(watch.since().map((e) => e.key)).toEqual(["roundup:ok", "roundup:w2"]);
  });
});

import {
  DEFAULT_BREAK_IN,
  VOLCANO_BREAK_IN_WINDOW_MS,
  mergeBreakIn,
  qualifiesAsBreakIn,
  type BreakInConfig,
  type FreshEvent,
} from "./director-break-in";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig } from "./director";

const POOL = { minQuakeMag: 4.5, minAlertSeverity: 3 };
const NOW = Date.UTC(2026, 9, 4, 12);
const MIN = 60_000;
const noFavourites = { countries: new Set<string>(), regions: new Set<string>() };

const cfg = (over: Partial<BreakInConfig> = {}) => mergeBreakIn(DEFAULT_BREAK_IN, over, POOL);

describe("mergeBreakIn", () => {
  it("follows the pool bar by default", () => {
    const out = mergeBreakIn(DEFAULT_BREAK_IN, {}, POOL);
    expect(out.minQuakeMag).toBe(4.5);
    expect(out.minAlertSeverity).toBe(3);
  });

  // Both directions, so a later "simplification" can't quietly drop the clamp.
  it("raises a break-in bar set below the pool bar", () => {
    const out = mergeBreakIn(DEFAULT_BREAK_IN, { minQuakeMag: 3, minAlertSeverity: 1 }, POOL);
    expect(out.minQuakeMag).toBe(4.5);
    expect(out.minAlertSeverity).toBe(3);
  });

  it("keeps a break-in bar set above the pool bar", () => {
    const out = mergeBreakIn(DEFAULT_BREAK_IN, { minQuakeMag: 6.2, minAlertSeverity: 4 }, POOL);
    expect(out.minQuakeMag).toBe(6.2);
    expect(out.minAlertSeverity).toBe(4);
  });

  it("re-clamps when the pool bar is raised later", () => {
    const base = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, { breakIn: { minQuakeMag: 5 } as any });
    expect(base.breakIn.minQuakeMag).toBe(5);
    const raised = mergeDirectorConfig(base, { minQuakeMag: 6 });
    expect(raised.breakIn.minQuakeMag).toBe(6);
  });

  it("merges reasons key by key and drops unknown keys", () => {
    const out = mergeBreakIn(DEFAULT_BREAK_IN, { reasons: { roundup: true, bogus: true }, bogus: 1 }, POOL);
    expect(out.reasons).toEqual({ quake: true, storm: true, volcano: true, roundup: true });
    expect("bogus" in out).toBe(false);
    expect("bogus" in out.reasons).toBe(false);
  });

  it("rejects invalid enums and clamps numbers", () => {
    const out = mergeBreakIn(
      DEFAULT_BREAK_IN,
      { interrupt: "sometimes", incoming: "loud", volcanoMin: "dormant", windowMinutes: 0, clusterMin: 99, incomingSeconds: 60, cooldownSeconds: 1 },
      POOL,
    );
    expect(out.interrupt).toBe("boundary");
    expect(out.incoming).toBe("breakIns");
    expect(out.volcanoMin).toBe("erupting");
    expect(out.windowMinutes).toBe(1);
    expect(out.clusterMin).toBe(10);
    expect(out.incomingSeconds).toBe(15);
    expect(out.cooldownSeconds).toBe(10);
  });

  it("ignores a non-object patch", () => {
    expect(mergeBreakIn(DEFAULT_BREAK_IN, null, POOL)).toEqual(cfg());
  });
});

describe("qualifiesAsBreakIn", () => {
  const quake = (ageMin: number, mag = 5): FreshEvent => ({ reason: "quake", at: NOW - ageMin * MIN, mag });
  const storm = (ageMin: number, severityRank = 3): FreshEvent => ({ reason: "storm", at: NOW - ageMin * MIN, severityRank });

  it("matches the old 20 minute window at the edge", () => {
    expect(qualifiesAsBreakIn(quake(20), cfg(), noFavourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(quake(20.01), cfg(), noFavourites, NOW)).toBe(false);
    expect(qualifiesAsBreakIn(storm(20), cfg(), noFavourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(storm(21), cfg(), noFavourites, NOW)).toBe(false);
  });

  it("uses the channel's own window", () => {
    expect(qualifiesAsBreakIn(quake(45), cfg({ windowMinutes: 60 }), noFavourites, NOW)).toBe(true);
  });

  it("never qualifies an event with an unknown time", () => {
    expect(qualifiesAsBreakIn({ reason: "quake", at: NaN, mag: 7 }, cfg(), noFavourites, NOW)).toBe(false);
  });

  it("applies the threshold at its edge", () => {
    const c = cfg({ minQuakeMag: 6, minAlertSeverity: 4 });
    expect(qualifiesAsBreakIn(quake(1, 6), c, noFavourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(quake(1, 5.9), c, noFavourites, NOW)).toBe(false);
    expect(qualifiesAsBreakIn(storm(1, 4), c, noFavourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(storm(1, 3), c, noFavourites, NOW)).toBe(false);
  });

  it("respects a disabled reason", () => {
    expect(qualifiesAsBreakIn(quake(1), cfg({ reasons: { quake: false } as any }), noFavourites, NOW)).toBe(false);
  });

  it("breaks in for eruptions only by default, and unrest when opted in", () => {
    const erupting: FreshEvent = { reason: "volcano", at: NOW - 60 * MIN, volcanoLevel: "erupting" };
    const unrest: FreshEvent = { reason: "volcano", at: NOW - 60 * MIN, volcanoLevel: "unrest" };
    expect(qualifiesAsBreakIn(erupting, cfg(), noFavourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(unrest, cfg(), noFavourites, NOW)).toBe(false);
    expect(qualifiesAsBreakIn(unrest, cfg({ volcanoMin: "unrest" }), noFavourites, NOW)).toBe(true);
  });

  it("keeps the volcano's own 6 hour window", () => {
    const at = (ms: number): FreshEvent => ({ reason: "volcano", at: NOW - ms, volcanoLevel: "erupting" });
    expect(qualifiesAsBreakIn(at(VOLCANO_BREAK_IN_WINDOW_MS), cfg(), noFavourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(at(VOLCANO_BREAK_IN_WINDOW_MS + 1), cfg(), noFavourites, NOW)).toBe(false);
  });

  it("only breaks in for a favourite place's round-up, or the world round-up when opted in", () => {
    const on = cfg({ reasons: { roundup: true } as any });
    const favourites = { countries: new Set(["uk"]), regions: new Set(["alps"]) };
    const ev = (placeKind: FreshEvent["placeKind"], placeId?: string): FreshEvent => ({ reason: "roundup", at: NOW, placeKind, placeId });
    expect(qualifiesAsBreakIn(ev("country", "uk"), on, favourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(ev("country", "japan"), on, favourites, NOW)).toBe(false);
    expect(qualifiesAsBreakIn(ev("region", "alps"), on, favourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(ev("world"), on, favourites, NOW)).toBe(false);
    expect(qualifiesAsBreakIn(ev("world"), cfg({ reasons: { roundup: true } as any, worldRoundup: true }), favourites, NOW)).toBe(true);
    expect(qualifiesAsBreakIn(ev("country", "uk"), cfg(), favourites, NOW)).toBe(false);
  });
});

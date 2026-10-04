import {
  DEFAULT_BREAK_IN,
  VOLCANO_BREAK_IN_WINDOW_MS,
  mergeBreakIn,
  qualifiesAsBreakIn,
  reconcilePending,
  selectBreakIn,
  type BreakInConfig,
  type BreakInRunnerView,
  type FreshEvent as QueueEvent,
  type PendingBreakIn,
  type BreakInFacts as FreshEvent,
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

describe("break-in queue", () => {
  const immediate = (over: Partial<BreakInConfig> = {}) => cfg({ interrupt: "immediate", ...over });
  const view = (over: Partial<BreakInRunnerView> = {}): BreakInRunnerView => ({
    now: NOW,
    current: { id: "country:uk", kind: "country", startedAt: NOW - 60_000 },
    seen: new Set(),
    handled: new Set(),
    lastBreakInAt: 0,
    lastRoundupBreakInAt: 0,
    favourites: noFavourites,
    paused: false,
    ...over,
  });
  let n = 0;
  const warning = (over: Partial<QueueEvent> = {}): QueueEvent => {
    const id = `storm:nws:w${++n}`;
    return { reason: "storm", at: NOW - 60_000, severityRank: 3, segmentId: id, key: id, score: 86, title: id, ...over };
  };
  const pend = (ev: QueueEvent): PendingBreakIn => ({ ...ev, queuedAt: NOW - 1000 });

  describe("reconcilePending", () => {
    // The regression this queue exists to prevent: a burst lands in one tick
    // and only one of them survives.
    it("keeps every member of a burst that lands in one tick", () => {
      const burst = [warning(), warning(), warning(), warning()];
      const out = reconcilePending([], burst, immediate(), view());
      expect(out.pending.map((p) => p.key).sort()).toEqual(burst.map((b) => b.key).sort());
      expect(out.aged).toEqual([]);
      expect(out.dropped).toEqual([]);
    });

    it("keeps an event not picked this tick in the queue next tick", () => {
      const a = warning();
      const b = warning();
      const first = reconcilePending([], [a, b], immediate(), view());
      // `a` airs (handled); `b` was not picked and is still there.
      const second = reconcilePending(first.pending, [a, b], immediate(), view({ handled: new Set([a.key]) }));
      expect(second.pending.map((p) => p.key)).toEqual([b.key]);
    });

    it("de-dupes by key across the queue and the ring", () => {
      const a = warning();
      const out = reconcilePending([pend(a)], [a, a], immediate(), view());
      expect(out.pending).toHaveLength(1);
    });

    it("skips events already handled or already aired", () => {
      const aired = warning();
      const handled = warning();
      const out = reconcilePending([], [aired, handled], immediate(), view({ seen: new Set([aired.segmentId]), handled: new Set([handled.key]) }));
      expect(out.pending).toEqual([]);
    });

    it("never queues an event that doesn't qualify on this channel", () => {
      const weak = warning({ severityRank: 2 });
      expect(reconcilePending([], [weak], immediate(), view()).pending).toEqual([]);
    });

    it("ages out a queued event past the freshness window and reports it", () => {
      const old = pend(warning({ at: NOW - 21 * MIN }));
      const out = reconcilePending([old], [], immediate(), view());
      expect(out.pending).toEqual([]);
      expect(out.aged).toEqual([old]);
    });

    it("trims to maxPending by score, dropping the lowest — never a big quake for a pile of warnings", () => {
      const warnings = Array.from({ length: 4 }, () => warning({ score: 86 }));
      const quake: QueueEvent = { reason: "quake", at: NOW - MIN, mag: 7.1, segmentId: "quake:q", key: "quake:q", score: 111, title: "M7.1" };
      const out = reconcilePending([], [...warnings, quake], immediate({ maxPending: 3 }), view());
      expect(out.pending[0].key).toBe("quake:q");
      expect(out.pending).toHaveLength(3);
      expect(out.dropped).toHaveLength(2);
      expect(out.dropped.every((d) => d.reason === "storm")).toBe(true);
    });

    it("stamps when an event was queued", () => {
      expect(reconcilePending([], [warning()], immediate(), view()).pending[0].queuedAt).toBe(NOW);
    });
  });

  describe("selectBreakIn", () => {
    const one = () => [pend(warning())];

    it("does nothing in boundary mode, when disabled, or while paused", () => {
      expect(selectBreakIn(one(), cfg(), view())).toBeNull();
      expect(selectBreakIn(one(), immediate({ enabled: false }), view())).toBeNull();
      expect(selectBreakIn(one(), immediate(), view({ paused: true }))).toBeNull();
    });

    it("never interrupts an ad", () => {
      expect(selectBreakIn(one(), immediate(), view({ current: { id: "ad:a", kind: "ad", startedAt: NOW - 60_000 } }))).toBeNull();
    });

    it("never interrupts a shot younger than the guard", () => {
      const young = view({ current: { id: "country:uk", kind: "country", startedAt: NOW - 3_000 } });
      expect(selectBreakIn(one(), immediate({ guardSeconds: 6 }), young)).toBeNull();
      expect(selectBreakIn(one(), immediate({ guardSeconds: 2 }), young)).not.toBeNull();
    });

    it("respects the event cooldown, and the round-up cooldown separately", () => {
      const recent = view({ lastBreakInAt: NOW - 60_000 });
      expect(selectBreakIn(one(), immediate({ cooldownSeconds: 120 }), recent)).toBeNull();
      const roundup = pend({ reason: "roundup", at: NOW, placeKind: "world", segmentId: "global:r", key: "roundup:r", score: 8, title: "r" });
      const on = immediate({ reasons: { ...DEFAULT_BREAK_IN.reasons, roundup: true }, worldRoundup: true });
      expect(selectBreakIn([roundup], on, recent)?.items[0].key).toBe("roundup:r");
      expect(selectBreakIn([roundup], on, view({ lastRoundupBreakInAt: NOW - MIN }))).toBeNull();
    });

    it("skips the current segment, aired ones, handled ones and the current shot's area", () => {
      const cur = pend(warning({ segmentId: "storm:nws:cur", key: "storm:nws:cur" }));
      const aired = pend(warning());
      const handled = pend(warning());
      const sameArea = pend(warning({ areaKey: "country:GB" }));
      const r = view({
        current: { id: "storm:nws:cur", kind: "storm", startedAt: NOW - 60_000, areaKey: "country:GB" },
        seen: new Set([aired.segmentId]),
        handled: new Set([handled.key]),
      });
      expect(selectBreakIn([cur, aired, handled, sameArea], immediate(), r)).toBeNull();
    });

    it("takes reasons in priority order, then the highest score", () => {
      const storm = pend(warning({ score: 98 }));
      const small = pend({ reason: "quake", at: NOW - MIN, mag: 5, segmentId: "quake:s", key: "quake:s", score: 90, title: "s" });
      const big = pend({ reason: "quake", at: NOW - MIN, mag: 6, segmentId: "quake:b", key: "quake:b", score: 100, title: "b" });
      expect(selectBreakIn([storm, small, big], immediate(), view())).toEqual({ type: "single", reason: "quake", items: [big] });
    });

    it("groups a burst of one reason inside the window, at the clusterMin edge", () => {
      const burst = [0, 30, 60].map((s) => pend(warning({ at: NOW - 120_000 + s * 1000 })));
      const pick = selectBreakIn(burst, immediate({ clusterMin: 3, clusterWindowSeconds: 60 }), view());
      expect(pick?.type).toBe("group");
      expect(pick?.items).toHaveLength(3);
      expect(selectBreakIn(burst.slice(0, 2), immediate({ clusterMin: 3 }), view())?.type).toBe("single");
    });

    it("doesn't group events spread wider than the window", () => {
      const spread = [0, 100, 200].map((s) => pend(warning({ at: NOW - 300_000 + s * 1000 })));
      expect(selectBreakIn(spread, immediate({ clusterMin: 3, clusterWindowSeconds: 60 }), view())?.type).toBe("single");
    });

    it("never groups when clusterMin is 0", () => {
      const burst = [1, 2, 3, 4].map(() => pend(warning()));
      expect(selectBreakIn(burst, immediate({ clusterMin: 0 }), view())?.type).toBe("single");
    });

    it("caps a group at twice clusterMin", () => {
      const burst = Array.from({ length: 9 }, () => pend(warning()));
      expect(selectBreakIn(burst, immediate({ clusterMin: 3 }), view())?.items).toHaveLength(6);
    });

    it("at a shot boundary drops the interrupt-only gates so a burst drains", () => {
      const r = view({ current: { id: "ad:a", kind: "ad", startedAt: NOW - 1000, areaKey: "country:US" }, lastBreakInAt: NOW - 1000 });
      const ev = pend(warning({ areaKey: "country:US" }));
      expect(selectBreakIn([ev], immediate(), r)).toBeNull();
      expect(selectBreakIn([ev], immediate(), r, { atBoundary: true })?.items[0]).toBe(ev);
    });

    it("never changes the queue it is given", () => {
      const q = one();
      const copy = JSON.parse(JSON.stringify(q));
      selectBreakIn(q, immediate(), view());
      expect(q).toEqual(copy);
    });
  });
});

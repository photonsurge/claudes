import { selectNext, selectPriority, type Candidate } from "./director-select";
import type { Segment, SegmentKind } from "./director";

const seg = (id: string, kind: SegmentKind, center: [number, number] = [0, 0]): Segment => ({
  id,
  kind,
  title: id,
  camera: { center, zoom: 3 },
  patch: {},
  holdMs: 12000,
});

const cand = (id: string, kind: SegmentKind, center?: [number, number], score = 1, areaKey?: string): Candidate => ({
  segment: seg(id, kind, center),
  score,
  areaKey,
});

describe("selectNext", () => {
  it("returns null only for an empty pool", () => {
    expect(selectNext([], { history: [] })).toBeNull();
  });

  it("opens the session on the intro spin", () => {
    const pool = [cand("country:a", "country"), cand("intro:global", "intro"), cand("global:world", "global")];
    expect(selectNext(pool, { history: [], isFirst: true })?.kind).toBe("intro");
  });

  it("retires the intro after the opener — it never recurs in rotation", () => {
    const pool = [cand("intro:global", "intro"), cand("global:world", "global"), cand("country:a", "country")];
    // On any cut but the first, the intro is excluded from the pool entirely (it's
    // a one-time opener). Sweep the rng: only the global spin / country ever come up.
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const kind = selectNext(pool, { history: ["quake:z"], rng: () => i / 20 })?.kind;
      if (kind) seen.add(kind);
    }
    expect(seen.has("intro")).toBe(false);
    expect(seen.has("global")).toBe(true);
  });

  it("airs the recurring global spin as ordinary filler (the intro's old recurring role)", () => {
    const pool = [cand("global:world", "global"), cand("country:a", "country")];
    // Last shot was a country shot, so the global spin is eligible; rng→0 picks the first kind.
    expect(selectNext(pool, { history: ["country:a"], rng: () => 0 })?.kind).toBe("global");
  });

  it("cycles the least-aired item of a kind before repeating", () => {
    const pool = [cand("country:a", "country"), cand("country:b", "country")];
    const counts = new Map([["country:a", 1]]); // a already shown once, b never
    // Only b is at the minimum count → it's picked regardless of rng.
    expect(selectNext(pool, { history: [], counts, rng: () => 0 })?.id).toBe("country:b");
  });

  it("picks at random among equally-least-aired items", () => {
    const pool = [cand("country:a", "country"), cand("country:b", "country")];
    // Both at count 0 → both eligible; rng near 1 selects the second.
    expect(selectNext(pool, { history: [], rng: () => 0.99 })?.id).toBe("country:b");
  });

  it("avoids repeating the just-aired kind when another exists", () => {
    const pool = [cand("quake:x", "quake"), cand("country:a", "country")];
    expect(selectNext(pool, { history: ["quake:y"], rng: () => 0 })?.kind).toBe("country");
  });

  it("spreads located shots away from a recently-aired region", () => {
    const pool = [cand("storm:a", "storm", [10, 47]), cand("storm:b", "storm", [100, 0])];
    // storm:a sits on a just-aired center → storm:b is chosen.
    expect(
      selectNext(pool, { history: [], recentCenters: [[10, 47]], rng: () => 0 })?.id,
    ).toBe("storm:b");
  });

  it("moves a kind away from the area where that kind last aired", () => {
    const pool = [
      cand("storm:kz-1", "storm", [66, 48], 1, "country:KZ"),
      cand("storm:kz-2", "storm", [82, 43], 1, "country:KZ"),
      cand("storm:jp", "storm", [139, 36], 1, "country:JP"),
    ];
    const lastAreaByKind = new Map<SegmentKind, string>([["storm", "country:KZ"]]);
    expect(selectNext(pool, { history: [], lastAreaByKind, rng: () => 0 })?.id).toBe("storm:jp");
  });

  it("falls back to the same area when a kind has nowhere else available", () => {
    const pool = [
      cand("storm:kz-1", "storm", [66, 48], 1, "country:KZ"),
      cand("storm:kz-2", "storm", [82, 43], 1, "country:KZ"),
    ];
    const lastAreaByKind = new Map<SegmentKind, string>([["storm", "country:KZ"]]);
    expect(selectNext(pool, { history: [], lastAreaByKind, rng: () => 0 })).not.toBeNull();
  });

  it("kind weights bias the kind draw — a heavy kind claims more of the rng range", () => {
    const pool = [cand("country:a", "country"), cand("ship:s", "ship")];
    // Unweighted, the kinds split the [0,1) roll evenly: 0.6 lands on ship.
    expect(selectNext(pool, { history: [], rng: () => 0.6 })?.kind).toBe("ship");
    // country ×4 → country owns 4/5 of the roll; the same 0.6 now lands on it.
    expect(
      selectNext(pool, { history: [], rng: () => 0.6, kindWeights: { country: 4 } })?.kind,
    ).toBe("country");
    // But even a heavy weight never monopolises: a roll in ship's tail still picks ship.
    expect(
      selectNext(pool, { history: [], rng: () => 0.95, kindWeights: { country: 4 } })?.kind,
    ).toBe("ship");
  });

  it("absent or invalid weights fall back to uniform — existing behaviour unchanged", () => {
    const pool = [cand("country:a", "country"), cand("ship:s", "ship")];
    for (const kindWeights of [undefined, {}, { country: NaN, ship: -2 }] as const) {
      expect(selectNext(pool, { history: [], rng: () => 0.1, kindWeights })?.kind).toBe("country");
      expect(selectNext(pool, { history: [], rng: () => 0.9, kindWeights })?.kind).toBe("ship");
    }
  });
});

describe("selectPriority", () => {
  it("returns null when nothing new is waiting", () => {
    const pool = [cand("country:a", "country")];
    expect(selectPriority(pool, new Map())).toBeNull();
  });

  it("ignores an already-aired quake/storm", () => {
    const pool = [cand("quake:x", "quake"), cand("storm:y", "storm")];
    const counts = new Map([
      ["quake:x", 1],
      ["storm:y", 1],
    ]);
    expect(selectPriority(pool, counts)).toBeNull();
  });

  it("picks the highest-scored candidate within a priority kind", () => {
    const pool = [
      cand("quake:small", "quake", undefined, 60),
      cand("quake:big", "quake", undefined, 140),
    ];
    expect(selectPriority(pool, new Map())?.id).toBe("quake:big");
  });

  it("moves breaking alerts to another area when one is available", () => {
    const pool = [
      { ...cand("storm:kz", "storm", [70, 48], 100, "country:KZ"), breaking: true },
      { ...cand("storm:jp", "storm", [139, 36], 80, "country:JP"), breaking: true },
    ];
    const lastAreaByKind = new Map<SegmentKind, string>([["storm", "country:KZ"]]);
    expect(selectPriority(pool, new Map(), { lastAreaByKind })?.id).toBe("storm:jp");
  });

  it("doesn't preempt for ordinary filler kinds", () => {
    const pool = [cand("country:a", "country"), cand("country:b", "country")];
    expect(selectPriority(pool, new Map())).toBeNull();
  });

  it("doesn't let a backlog of unaired-but-stale quakes camp the priority tier", () => {
    // A fresh session backlog (e.g. just entered auto mode) can carry many
    // unaired quakes that aren't actually breaking — they should fall through
    // to fair rotation instead of forcing the whole backlog onto air in a row.
    const pool = [
      { ...cand("quake:old1", "quake"), breaking: false },
      { ...cand("quake:old2", "quake"), breaking: false },
      cand("country:a", "country"),
    ];
    expect(selectPriority(pool, new Map())).toBeNull();
  });

  it("still preempts for a quake explicitly flagged breaking", () => {
    const pool = [{ ...cand("quake:new", "quake"), breaking: true }, cand("country:a", "country")];
    expect(selectPriority(pool, new Map())?.id).toBe("quake:new");
  });

  it("suppresses even a genuinely breaking candidate during cooldown", () => {
    // A continuous stream of genuinely-new alerts (real-world scale: NWS +
    // Meteoalarm + WMO + GDACS combined) must still interleave with fair
    // rotation rather than preempting every cut back to back.
    const pool = [{ ...cand("storm:new", "storm"), breaking: true }];
    expect(selectPriority(pool, new Map(), { cooldown: true })).toBeNull();
    expect(selectPriority(pool, new Map(), { cooldown: false })?.id).toBe("storm:new");
  });

  it("never preempts for a round-up (it rides the global spin, not the priority tier)", () => {
    // A round-up now rides a `global` segment (id `global:<docid>`); it must NOT
    // cut the line like a breaking quake — it surfaces through fair rotation.
    const roundup = { ...cand("global:sum1", "global"), score: 8 };
    roundup.segment.summary = {
      id: "sum1",
      period: "daily",
      narrative: "n",
      generatedAt: "2026-07-10T00:00:00Z",
    };
    const pool = [roundup, cand("country:a", "country")];
    expect(selectPriority(pool, new Map())).toBeNull();
  });
});

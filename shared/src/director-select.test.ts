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

const cand = (id: string, kind: SegmentKind, center?: [number, number], score = 1): Candidate => ({
  segment: seg(id, kind, center),
  score,
});

describe("selectNext", () => {
  it("returns null only for an empty pool", () => {
    expect(selectNext([], { history: [] })).toBeNull();
  });

  it("opens the session on the intro spin", () => {
    const pool = [cand("tour:a", "tour"), cand("intro:global", "intro")];
    expect(selectNext(pool, { history: [], isFirst: true })?.kind).toBe("intro");
  });

  it("doesn't re-air the intro immediately after itself (avoid a kind repeat)", () => {
    const pool = [cand("intro:global", "intro"), cand("tour:a", "tour")];
    // Last shot was the intro → the avoid-immediate-repeat rule steers to the tour.
    expect(selectNext(pool, { history: ["intro:global"], rng: () => 0 })?.kind).toBe("tour");
  });

  it("re-airs the intro later as a recurring global spin (it tours map types now)", () => {
    const pool = [cand("intro:global", "intro"), cand("tour:a", "tour")];
    // Last shot was a tour, so the intro is eligible again; rng→0 picks the first kind.
    expect(selectNext(pool, { history: ["tour:a"], rng: () => 0 })?.kind).toBe("intro");
  });

  it("cycles the least-aired item of a kind before repeating", () => {
    const pool = [cand("tour:a", "tour"), cand("tour:b", "tour")];
    const counts = new Map([["tour:a", 1]]); // a already shown once, b never
    // Only b is at the minimum count → it's picked regardless of rng.
    expect(selectNext(pool, { history: [], counts, rng: () => 0 })?.id).toBe("tour:b");
  });

  it("picks at random among equally-least-aired items", () => {
    const pool = [cand("tour:a", "tour"), cand("tour:b", "tour")];
    // Both at count 0 → both eligible; rng near 1 selects the second.
    expect(selectNext(pool, { history: [], rng: () => 0.99 })?.id).toBe("tour:b");
  });

  it("avoids repeating the just-aired kind when another exists", () => {
    const pool = [cand("quake:x", "quake"), cand("tour:a", "tour")];
    expect(selectNext(pool, { history: ["quake:y"], rng: () => 0 })?.kind).toBe("tour");
  });

  it("spreads located shots away from a recently-aired region", () => {
    const pool = [cand("storm:a", "storm", [10, 47]), cand("storm:b", "storm", [100, 0])];
    // storm:a sits on a just-aired center → storm:b is chosen.
    expect(
      selectNext(pool, { history: [], recentCenters: [[10, 47]], rng: () => 0 })?.id,
    ).toBe("storm:b");
  });
});

describe("selectPriority", () => {
  it("returns null when nothing new is waiting", () => {
    const pool = [cand("tour:a", "tour")];
    expect(selectPriority(pool, new Map())).toBeNull();
  });

  it("ignores an already-aired quake/storm/summary", () => {
    const pool = [cand("quake:x", "quake"), cand("summary:y", "summary")];
    const counts = new Map([
      ["quake:x", 1],
      ["summary:y", 1],
    ]);
    expect(selectPriority(pool, counts)).toBeNull();
  });

  it("puts a fresh round-up ahead of a brand-new quake/storm", () => {
    const pool = [cand("quake:x", "quake"), cand("summary:y", "summary"), cand("storm:z", "storm")];
    expect(selectPriority(pool, new Map())?.id).toBe("summary:y");
  });

  it("falls through to quake/storm once no summary is waiting", () => {
    const pool = [cand("tour:a", "tour"), cand("storm:z", "storm", undefined, 62)];
    expect(selectPriority(pool, new Map())?.id).toBe("storm:z");
  });

  it("picks the highest-scored candidate within a priority kind", () => {
    const pool = [
      cand("quake:small", "quake", undefined, 60),
      cand("quake:big", "quake", undefined, 140),
    ];
    expect(selectPriority(pool, new Map())?.id).toBe("quake:big");
  });

  it("doesn't preempt for ordinary filler kinds", () => {
    const pool = [cand("tour:a", "tour"), cand("country:b", "country")];
    expect(selectPriority(pool, new Map())).toBeNull();
  });
});

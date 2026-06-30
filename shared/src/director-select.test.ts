import { selectNext, type Candidate } from "./director-select";
import type { Segment, SegmentKind } from "./director";

const seg = (id: string, kind: SegmentKind, center: [number, number] = [0, 0]): Segment => ({
  id,
  kind,
  title: id,
  camera: { center, zoom: 3 },
  patch: {},
  holdMs: 12000,
});

const cand = (id: string, kind: SegmentKind, center?: [number, number]): Candidate => ({
  segment: seg(id, kind, center),
  score: 1,
});

describe("selectNext", () => {
  it("returns null only for an empty pool", () => {
    expect(selectNext([], { history: [] })).toBeNull();
  });

  it("opens the session on the intro spin", () => {
    const pool = [cand("tour:a", "tour"), cand("intro:global", "intro")];
    expect(selectNext(pool, { history: [], isFirst: true })?.kind).toBe("intro");
  });

  it("never airs the intro again after the opener", () => {
    const pool = [cand("intro:global", "intro"), cand("tour:a", "tour")];
    expect(selectNext(pool, { history: ["intro:global"], rng: () => 0 })?.kind).toBe("tour");
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

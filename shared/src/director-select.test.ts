import { selectNext, type Candidate } from "./director-select";
import type { Segment, SegmentKind } from "./director";

const seg = (id: string, kind: SegmentKind): Segment => ({
  id,
  kind,
  title: id,
  camera: { center: [0, 0], zoom: 3 },
  patch: {},
  holdMs: 12000,
});

const cand = (id: string, kind: SegmentKind, score: number): Candidate => ({
  segment: seg(id, kind),
  score,
});

describe("selectNext", () => {
  it("returns null only for an empty pool", () => {
    expect(selectNext([], { history: [] })).toBeNull();
  });

  it("picks the highest score from a cold start", () => {
    const pool = [cand("tour:a", "tour", 1), cand("quake:x", "quake", 50)];
    expect(selectNext(pool, { history: [] })?.id).toBe("quake:x");
  });

  it("skips segments still on cooldown", () => {
    const pool = [cand("quake:x", "quake", 50), cand("tour:a", "tour", 1)];
    // quake:x just aired — it should not be re-selected immediately.
    expect(selectNext(pool, { history: ["quake:x"] })?.id).toBe("tour:a");
  });

  it("prefers a different kind than what just aired", () => {
    const pool = [
      cand("quake:y", "quake", 40), // same kind as last, slightly lower
      cand("storm:z", "storm", 30),
    ];
    // last aired was a quake; even though quake:y scores higher, prefer variety.
    expect(selectNext(pool, { history: ["quake:x"] })?.kind).toBe("storm");
  });

  it("relaxes cooldown rather than airing nothing", () => {
    const pool = [cand("tour:a", "tour", 1)];
    // only candidate is on cooldown, but we must still return something.
    expect(selectNext(pool, { history: ["tour:a"] })?.id).toBe("tour:a");
  });

  it("breaks score ties deterministically by id", () => {
    const pool = [cand("tour:b", "tour", 5), cand("tour:a", "tour", 5)];
    expect(selectNext(pool, { history: [] })?.id).toBe("tour:a");
  });
});

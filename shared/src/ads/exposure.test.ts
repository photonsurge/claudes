import { planExposure, type ExposureKey, type OpenExposure } from "./exposure";

const NOW = Date.parse("2026-08-28T12:00:00Z");
const STALE = 3 * 60_000; // 3 sweep intervals

const key = (adId: string, sceneId = "default"): ExposureKey => ({ adId, sceneId });
const win = (id: string, adId: string, over: Partial<OpenExposure> = {}): OpenExposure => ({
  id,
  adId,
  sceneId: "default",
  startedAt: NOW - 60 * 60_000,
  lastSeenAt: NOW - 60_000, // fresh: one sweep ago
  ...over,
});

describe("planExposure", () => {
  it("opens a window for a new pair and touches an already-open one", () => {
    const plan = planExposure([win("w1", "a")], [key("a"), key("b")], NOW, STALE);
    expect(plan.open).toEqual([key("b")]);
    expect(plan.touch).toEqual(["w1"]);
    expect(plan.close).toEqual([]);
  });

  it("closes at NOW when a fresh pair stops airing", () => {
    const plan = planExposure([win("w1", "a")], [], NOW, STALE);
    expect(plan.close).toEqual([{ id: "w1", at: NOW }]);
    expect(plan.open).toEqual([]);
  });

  it("never credits downtime: a stale window closes at its last heartbeat", () => {
    const lastSeen = NOW - 45 * 60_000; // worker was down 45 min
    const gone = planExposure([win("w1", "a", { lastSeenAt: lastSeen })], [], NOW, STALE);
    expect(gone.close).toEqual([{ id: "w1", at: lastSeen }]);

    // Still airing after the gap: old window closes at the heartbeat and a
    // fresh one opens at NOW — the gap stays unlogged.
    const back = planExposure([win("w1", "a", { lastSeenAt: lastSeen })], [key("a")], NOW, STALE);
    expect(back.close).toEqual([{ id: "w1", at: lastSeen }]);
    expect(back.open).toEqual([key("a")]);
    expect(back.touch).toEqual([]);
  });

  it("treats the same ad on two scenes as independent windows", () => {
    const open = [win("w1", "a"), win("w2", "a", { sceneId: "storm" })];
    const plan = planExposure(open, [key("a", "storm")], NOW, STALE);
    expect(plan.close).toEqual([{ id: "w1", at: NOW }]);
    expect(plan.touch).toEqual(["w2"]);
  });

  it("keeps the newest of duplicate open windows and closes the rest", () => {
    const older = win("w1", "a", { startedAt: NOW - 2 * 60 * 60_000, lastSeenAt: NOW - 90_000 });
    const newer = win("w2", "a", { startedAt: NOW - 60_000 });
    const plan = planExposure([older, newer], [key("a")], NOW, STALE);
    expect(plan.close).toEqual([{ id: "w1", at: older.lastSeenAt }]);
    expect(plan.touch).toEqual(["w2"]);
    expect(plan.open).toEqual([]);
  });

  it("is a no-op given nothing open and nothing airing", () => {
    expect(planExposure([], [], NOW, STALE)).toEqual({ open: [], close: [], touch: [] });
  });
});

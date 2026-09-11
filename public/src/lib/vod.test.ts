import { asRunCoverage } from "./vod";
import type { AsRunItem } from "@photonsurge/shared/vod";

const cut = (offsetMs: number, endOffsetMs: number | null): AsRunItem<{ id: string }> => ({
  type: "cut",
  entry: { id: "e" },
  offsetMs,
  endOffsetMs,
  clippedStart: false,
  clippedEnd: false,
});

it("sums logged vs. unlogged time and counts cuts", () => {
  const items: AsRunItem<{ id: string }>[] = [
    { type: "gap", offsetMs: 0, endOffsetMs: 30_000, reason: "before-first-cut" },
    cut(30_000, 75_000),
    cut(75_000, 120_000),
    { type: "gap", offsetMs: 120_000, endOffsetMs: 600_000, reason: "after-last-cut" },
  ];
  expect(asRunCoverage(items)).toEqual({ cuts: 2, loggedMs: 90_000, gapMs: 510_000 });
});

it("measures the on-air shot up to now when it has no end yet", () => {
  expect(asRunCoverage([cut(0, 45_000), cut(45_000, null)], 100_000)).toEqual({ cuts: 2, loggedMs: 100_000, gapMs: 0 });
  expect(asRunCoverage([cut(45_000, null)])).toEqual({ cuts: 1, loggedMs: 0, gapMs: 0 });
});

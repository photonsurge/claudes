import { loadAsRunTimeline, vodLeadMsFromEnv } from "./vod-bundle";
import type { Run } from "./runs";

const T = (s: number) => 1_700_000_000_000 + s * 1000;
const run = (over: Partial<Run> = {}): Run => ({
  id: "r1",
  sceneId: "main",
  status: "ended",
  startAt: T(100),
  endedAt: T(700),
  platforms: { youtube: { broadcastId: "v", actualStartTime: T(103), actualEndTime: T(703) } },
  ...over,
});
const entry = (id: string, runId: string, kind: string, start: number, end: number | null) => ({
  id,
  runId,
  kind,
  startedAt: new Date(T(start)),
  endedAt: end == null ? null : new Date(T(end)),
});

it("reads the lead from the environment, tolerating junk", () => {
  expect(vodLeadMsFromEnv({})).toBe(0);
  expect(vodLeadMsFromEnv({ VOD_LEAD_MS: "2500" })).toBe(2500);
  expect(vodLeadMsFromEnv({ VOD_LEAD_MS: "soon" })).toBe(0);
});

it("windows the log on the video's YouTube-clock span (lead applied) and tallies sessions + kinds", async () => {
  const listEntriesInWindow = jest.fn(async () => [entry("a", "air-1", "quake", 90, 148), entry("b", "air-2", "storm", 148, 400)] as any);
  const out = await loadAsRunTimeline({ listEntriesInWindow }, run(), { leadMs: 2000, nowMs: T(900) });
  expect(listEntriesInWindow).toHaveBeenCalledWith({ sceneId: "main", from: new Date(T(101)), to: new Date(T(701)) });
  expect(out.base).toEqual({ baseMs: T(103), source: "youtube" });
  expect(out.window).toEqual({ fromMs: T(101), toMs: T(701) });
  expect(out.items.map((i) => i.type)).toEqual(["cut", "cut", "gap"]);
  expect(out.items[0]).toMatchObject({ offsetMs: 0, endOffsetMs: 47_000, clippedStart: true });
  expect(out.sessions).toEqual(["air-1", "air-2"]);
  expect(out.kindCounts).toEqual({ quake: 1, storm: 1 });
});

it("leaves a live run's window open and returns an empty bundle for a run that never went live", async () => {
  const listEntriesInWindow = jest.fn(async () => [] as any);
  const live = await loadAsRunTimeline({ listEntriesInWindow }, run({ status: "live", endedAt: null, platforms: { youtube: { broadcastId: "v" } } }), { nowMs: T(500) });
  expect(live.base).toEqual({ baseMs: T(100), source: "run" });
  expect(live.window).toEqual({ fromMs: T(100), toMs: null });
  expect(listEntriesInWindow).toHaveBeenCalledWith({ sceneId: "main", from: new Date(T(100)), to: new Date(T(500)) });

  const never = await loadAsRunTimeline({ listEntriesInWindow }, run({ status: "failed", startAt: null, endedAt: null, platforms: {} }));
  expect(never).toEqual({ base: null, window: null, sessions: [], kindCounts: {}, items: [] });
});

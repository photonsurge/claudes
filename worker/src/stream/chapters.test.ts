// The chapters publisher: reads the same shared as-run timeline the admin page
// does, writes the digest into the video description (operator text preserved),
// stamps the run, and is idempotent unless forced. YouTube + Mongo mocked.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));

const queueAdd = jest.fn(async () => ({}));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => ({ add: queueAdd })) }));

const runs = new Map<string, any>();
const updateRun = jest.fn(async (id: string, patch: any) => {
  runs.set(id, { ...(runs.get(id) ?? {}), ...patch });
  return runs.get(id);
});
const listEntriesInWindow = jest.fn(async () => [] as any[]);
const db = {
  getRun: jest.fn(async (id: string) => (runs.has(id) ? { ...runs.get(id) } : null)),
  updateRun,
  listScenes: jest.fn(async () => [{ id: "main", name: "Main" }]),
  airLog: { listEntriesInWindow },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

const setVideoDescription = jest.fn();
const getVideoStats = jest.fn(async () => [] as any[]);
jest.mock("../youtube/client", () => ({
  getYoutubeClient: jest.fn(async () => ({ accountId: "acc" })),
  getVideoStats: (...a: unknown[]) => getVideoStats(...a),
  setVideoDescription: (...a: unknown[]) => setVideoDescription(...a),
}));

import { chaptersEnabled, publishChapters, queueChapters } from "./chapters";

const T = (s: number) => 1_700_000_000_000 + s * 1000;
const finished = (over: any = {}) => ({
  id: "r1",
  sceneId: "main",
  status: "ended",
  title: "Morning globe",
  startAt: T(100),
  endedAt: T(700),
  platforms: { youtube: { broadcastId: "vid1", accountId: "acc", actualStartTime: T(103), actualEndTime: T(703) } },
  ...over,
});
const entry = (id: string, start: number, end: number, over: any = {}) => ({
  id,
  runId: "air-1",
  kind: "quake",
  segmentId: `quake:${id}`,
  title: `Quake ${id}`,
  breaking: false,
  timesShown: 1,
  startedAt: new Date(T(start)),
  endedAt: new Date(T(end)),
  ...over,
});

beforeEach(() => {
  runs.clear();
  jest.clearAllMocks();
  delete process.env.VOD_LEAD_MS;
  delete process.env.YOUTUBE_CHAPTERS;
  // Emulate YouTube: hand the composer the current description, return what changed.
  setVideoDescription.mockImplementation(async (_ctx, _id, compose: (s: string) => string) => {
    const description = compose("Our live globe.");
    return { changed: true, description };
  });
});

it("is on unless YOUTUBE_CHAPTERS=off", () => {
  expect(chaptersEnabled({})).toBe(true);
  expect(chaptersEnabled({ YOUTUBE_CHAPTERS: "off" })).toBe(false);
  expect(chaptersEnabled({ YOUTUBE_CHAPTERS: "OFF " })).toBe(false);
});

it("queues a delayed, retried foreground job", async () => {
  await queueChapters("r1");
  expect(queueAdd).toHaveBeenCalledWith(
    "do",
    { domain: "stream", type: "run-lifecycle", event: "chapters", data: { runId: "r1" } },
    expect.objectContaining({ delay: 30_000, attempts: 5 }),
  );
});

it("writes the as-run digest under the operator's text and stamps the run", async () => {
  runs.set("r1", finished());
  listEntriesInWindow.mockResolvedValue([entry("a", 133, 178, { breaking: true, subtitle: "M6.1 · Fiji" }), entry("b", 178, 400)]);

  const res = await publishChapters("r1");

  expect(res).toMatchObject({ ok: true, count: 3, changed: true });
  expect(listEntriesInWindow).toHaveBeenCalledWith({ sceneId: "main", from: new Date(T(103)), to: new Date(T(703)) });
  expect(setVideoDescription).toHaveBeenCalledWith(expect.anything(), "vid1", expect.any(Function));
  expect(res.descriptionLength).toBe(
    ["Our live globe.", "", "⏱ As aired", "0:00 Main", "0:30 🚨 Quake a · M6.1 · Fiji", "1:15 Quake b"].join("\n").length,
  );
  expect(runs.get("r1").chapters).toEqual({ publishedAt: expect.any(Number), count: 3, error: null });
  expect(getVideoStats).not.toHaveBeenCalled(); // times were already stamped
});

it("fetches and stamps YouTube's instants first when the run lacks them", async () => {
  runs.set("r1", finished({ platforms: { youtube: { broadcastId: "vid1", accountId: "acc" } } }));
  getVideoStats.mockResolvedValue([{ id: "vid1", liveStreamingDetails: { actualStartTime: new Date(T(103)).toISOString(), actualEndTime: new Date(T(703)).toISOString() } }]);
  await publishChapters("r1");
  expect(getVideoStats).toHaveBeenCalledWith(expect.anything(), ["vid1"]);
  expect(runs.get("r1").platforms.youtube).toMatchObject({ actualStartTime: T(103), actualEndTime: T(703) });
  expect(listEntriesInWindow).toHaveBeenCalledWith({ sceneId: "main", from: new Date(T(103)), to: new Date(T(703)) });
});

it("skips cleanly when there is nothing to publish", async () => {
  runs.set("live", finished({ id: "live", status: "live", endedAt: null }));
  runs.set("novid", finished({ id: "novid", platforms: {} }));
  runs.set("done", finished({ id: "done", chapters: { publishedAt: 1, count: 4, error: null } }));
  expect(await publishChapters("missing")).toEqual({ ok: false, error: "no such run" });
  expect(await publishChapters("live")).toEqual({ ok: false, skipped: "run is still live" });
  expect(await publishChapters("novid")).toEqual({ ok: false, skipped: "run has no YouTube video" });
  expect(await publishChapters("done")).toEqual({ ok: true, skipped: "already published", count: 4 });
  expect(setVideoDescription).not.toHaveBeenCalled();
  await publishChapters("done", { force: true });
  expect(setVideoDescription).toHaveBeenCalledTimes(1);
});

it("records the failure on the run and rethrows so BullMQ retries", async () => {
  runs.set("r1", finished());
  setVideoDescription.mockRejectedValue(new Error("videos.update: quotaExceeded"));
  await expect(publishChapters("r1")).rejects.toThrow("quotaExceeded");
  expect(runs.get("r1").chapters).toEqual({ publishedAt: null, count: 0, error: "videos.update: quotaExceeded" });
});

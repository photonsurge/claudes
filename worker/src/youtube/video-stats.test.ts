jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("./client", () => ({ getYoutubeClient: jest.fn(), getVideoStats: jest.fn() }));
import { getAppDb } from "@photonsurge/shared/db/index";
import { getYoutubeClient, getVideoStats } from "./client";
import { streamVideoStats } from "./video-stats";

const listRuns = jest.fn();
const run = (id: string, status = "live", accountId = "channel-a") => ({
  id, status, platforms: { youtube: { broadcastId: id, accountId } },
});
beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
  jest.clearAllMocks();
  (getAppDb as jest.Mock).mockResolvedValue({ listRuns });
  listRuns.mockResolvedValue([]);
  await streamVideoStats(); // Prune the previous test's cached runs.
  (getYoutubeClient as jest.Mock).mockImplementation(async (accountId) => ({ accountId }));
  (getVideoStats as jest.Mock).mockImplementation(async (_ctx, ids: string[]) => ids.map((id) => ({
    id, statistics: { viewCount: "100", likeCount: "0" }, liveStreamingDetails: { concurrentViewers: "12" },
  })));
});
afterEach(() => jest.useRealTimers());

it("batches by channel and shares concurrent refreshes and cached results", async () => {
  listRuns.mockResolvedValue([run("a"), run("b"), run("c", "live", "channel-b")]);
  const [result] = await Promise.all([streamVideoStats(), streamVideoStats()]);
  expect(getVideoStats).toHaveBeenCalledTimes(2);
  expect(getVideoStats).toHaveBeenCalledWith({ accountId: "channel-a" }, ["a", "b"]);
  expect(result.a).toMatchObject({ views: "100", likes: "0", watchingNow: "12" });
  await streamVideoStats();
  expect(getVideoStats).toHaveBeenCalledTimes(2);
});

it("refreshes live counters sooner than archives and clears viewers at end", async () => {
  listRuns.mockResolvedValue([run("a"), run("b", "ended")]);
  expect((await streamVideoStats()).b.watchingNow).toBeUndefined();
  jest.advanceTimersByTime(60_000);
  await streamVideoStats();
  expect(getVideoStats).toHaveBeenLastCalledWith({ accountId: "channel-a" }, ["a"]);
  listRuns.mockResolvedValue([run("a", "ended"), run("b", "ended")]);
  expect((await streamVideoStats()).a.watchingNow).toBeUndefined();
  expect(getVideoStats).toHaveBeenCalledTimes(3);
});

it("keeps old counts on failure, clears live viewers and backs off retries", async () => {
  listRuns.mockResolvedValue([run("a")]);
  await streamVideoStats();
  jest.advanceTimersByTime(60_000);
  (getVideoStats as jest.Mock).mockRejectedValue(new Error("quota exceeded"));
  const result = await streamVideoStats();
  expect(result.a).toMatchObject({ views: "100", fetchedAt: 1_000_000, error: expect.any(String) });
  expect(result.a.watchingNow).toBeUndefined();
  await streamVideoStats();
  expect(getVideoStats).toHaveBeenCalledTimes(2);
});

it("handles missing videos and absent counters without inventing zeroes", async () => {
  listRuns.mockResolvedValue([run("a"), run("b")]);
  (getVideoStats as jest.Mock).mockResolvedValue([{ id: "a", statistics: {} }]);
  const result = await streamVideoStats();
  expect(result.a.views).toBeUndefined();
  expect(result.a.watchingNow).toBeUndefined();
  expect(result.b.error).toBe("Video unavailable");
});

it("splits large channel batches into at most 50 videos", async () => {
  listRuns.mockResolvedValue(Array.from({ length: 51 }, (_, i) => run(String(i))));
  await streamVideoStats();
  expect((getVideoStats as jest.Mock).mock.calls.map((call) => call[1].length)).toEqual([50, 1]);
});

/** @jest-environment node */

/**
 * GET /api/vod/:videoId — the public per-video as-run. Pins: no auth needed,
 * lookup by broadcast id, a secret-free projection (no keys, encoder, slot or
 * session ids), and that finished videos are served through the shared cache
 * while live ones are always rebuilt.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockWithCache = jest.fn(async (_k: string, _ttl: number, fn: () => Promise<unknown>) => ({ value: await fn(), hit: false }));
jest.mock("../../../../lib/focus/focus-cache", () => ({ withCache: (...a: unknown[]) => (mockWithCache as any)(...a) }));

const mockGetRunByBroadcastId = jest.fn();
const mockListEntriesInWindow = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getRunByBroadcastId: (...a: unknown[]) => mockGetRunByBroadcastId(...a),
    listScenes: async () => [{ id: "main", name: "Main" }],
    airLog: { listEntriesInWindow: (...a: unknown[]) => mockListEntriesInWindow(...a) },
  }),
}));

import { GET } from "./route";

const T = (s: number) => 1_700_000_000_000 + s * 1000;
const get = (videoId: string) => GET(new Request(`http://x/api/vod/${videoId}`) as never, { params: Promise.resolve({ videoId }) });
const run = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  sceneId: "main",
  encoderId: "obs-2",
  slotId: "slot-1",
  status: "ended",
  title: "Morning globe",
  startAt: T(100),
  endedAt: T(700),
  platforms: { youtube: { broadcastId: "vid1", watchUrl: "https://youtu.be/vid1", streamName: "SECRET", ingestionAddress: "rtmp://x", actualStartTime: T(103), actualEndTime: T(703) } },
  ...over,
});

beforeEach(() => {
  mockGetRunByBroadcastId.mockReset().mockResolvedValue(run());
  mockListEntriesInWindow.mockReset().mockResolvedValue([
    { id: "e1", runId: "air-1", kind: "quake", title: "Quake", startedAt: new Date(T(103)).toISOString(), endedAt: new Date(T(200)).toISOString() },
  ]);
  mockWithCache.mockClear();
});

it("404s an unknown video id", async () => {
  mockGetRunByBroadcastId.mockResolvedValue(null);
  expect((await get("nope")).status).toBe(404);
});

it("serves a secret-free as-run for a finished video through the cache", async () => {
  const res = await get("vid1");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(mockGetRunByBroadcastId).toHaveBeenCalledWith("vid1");
  expect(body).toMatchObject({
    title: "Morning globe",
    sceneName: "Main",
    status: "ended",
    video: { id: "vid1", watchUrl: "https://youtu.be/vid1" },
    window: { fromMs: T(103), toMs: T(703) },
    kindCounts: { quake: 1 },
  });
  expect(body.items[0]).toMatchObject({ type: "cut", offsetMs: 0, endOffsetMs: 97_000 });
  const text = JSON.stringify(body);
  for (const leak of ["SECRET", "rtmp://", "obs-2", "slot-1", "sessions", "\"r1\""]) expect(text).not.toContain(leak);
  expect(mockWithCache).toHaveBeenCalledWith("vod:vid1:0", 300, expect.any(Function));
});

it("rebuilds a live video every time instead of caching it", async () => {
  mockGetRunByBroadcastId.mockResolvedValue(run({ status: "live", endedAt: null }));
  const body = await (await get("vid1")).json();
  expect(body.window.toMs).toBeNull();
  expect(mockWithCache).not.toHaveBeenCalled();
});

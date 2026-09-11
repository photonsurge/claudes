/** @jest-environment node */

/**
 * GET /api/streams/:id/asrun — the run ↔ director-log join. Pins: admin gate,
 * the window handed to the log (scene + video span on OUR clock, lead applied),
 * offsets computed from YouTube's actualStartTime when stamped, the live case
 * (open window, on-air shot stays open) and a run that never went live.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockRequireAdmin = jest.fn();
jest.mock("../../../../../lib/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a),
}));

const mockGetRun = jest.fn();
const mockListScenes = jest.fn();
const mockListEntriesInWindow = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getRun: (...a: unknown[]) => mockGetRun(...a),
    listScenes: (...a: unknown[]) => mockListScenes(...a),
    airLog: { listEntriesInWindow: (...a: unknown[]) => mockListEntriesInWindow(...a) },
  }),
}));

import { GET } from "./route";

const T = (s: number) => 1_700_000_000_000 + s * 1000;
const get = (id: string) => GET(new Request(`http://x/api/streams/${id}/asrun`) as never, { params: Promise.resolve({ id }) });

const run = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  sceneId: "main",
  status: "ended",
  title: "Morning globe",
  startAt: T(100),
  endedAt: T(700),
  platforms: {
    youtube: { broadcastId: "vid1", watchUrl: "https://youtu.be/vid1", streamName: "SECRET", actualStartTime: T(103), actualEndTime: T(703) },
  },
  ...over,
});
const entry = (id: string, start: number, end: number | null, over: Record<string, unknown> = {}) => ({
  id,
  runId: "air-1",
  kind: "quake",
  startedAt: new Date(T(start)).toISOString(),
  endedAt: end == null ? null : new Date(T(end)).toISOString(),
  ...over,
});

beforeEach(() => {
  mockRequireAdmin.mockReset().mockResolvedValue(true);
  mockGetRun.mockReset().mockResolvedValue(run());
  mockListScenes.mockReset().mockResolvedValue([{ id: "main", name: "Main" }]);
  mockListEntriesInWindow.mockReset().mockResolvedValue([]);
  delete process.env.VOD_LEAD_MS;
});

it("401s for non-admins without touching the db", async () => {
  mockRequireAdmin.mockResolvedValue(false);
  expect((await get("r1")).status).toBe(401);
  expect(mockGetRun).not.toHaveBeenCalled();
});

it("404s an unknown run", async () => {
  mockGetRun.mockResolvedValue(null);
  expect((await get("nope")).status).toBe(404);
});

it("joins the scene's cuts to the video window and places them at YouTube-clock offsets", async () => {
  mockListEntriesInWindow.mockResolvedValue([entry("a", 90, 148), entry("b", 148, 400, { kind: "storm", runId: "air-2" })]);
  const res = await get("r1");
  expect(res.status).toBe(200);
  const body = await res.json();

  // Window = YouTube's actual span, on our clock (lead 0).
  expect(mockListEntriesInWindow).toHaveBeenCalledWith({ sceneId: "main", from: new Date(T(103)), to: new Date(T(703)) });
  expect(body.window).toEqual({ fromMs: T(103), toMs: T(703) });
  expect(body.sceneName).toBe("Main");
  expect(body.video).toMatchObject({ id: "vid1", watchUrl: "https://youtu.be/vid1", base: { baseMs: T(103), source: "youtube" }, leadMs: 0 });
  expect(JSON.stringify(body)).not.toContain("SECRET");

  expect(body.items.map((i: { type: string }) => i.type)).toEqual(["cut", "cut", "gap"]);
  expect(body.items[0]).toMatchObject({ offsetMs: 0, endOffsetMs: 45_000, clippedStart: true, entry: { id: "a" } });
  expect(body.items[1]).toMatchObject({ offsetMs: 45_000, endOffsetMs: 297_000, entry: { id: "b" } });
  expect(body.items[2]).toMatchObject({ reason: "after-last-cut", offsetMs: 297_000, endOffsetMs: 600_000 });
  expect(body.sessions).toEqual(["air-1", "air-2"]);
  expect(body.kindCounts).toEqual({ quake: 1, storm: 1 });
});

it("shifts the window back and the offsets forward by VOD_LEAD_MS", async () => {
  process.env.VOD_LEAD_MS = "5000";
  mockListEntriesInWindow.mockResolvedValue([entry("a", 98, 200)]);
  const body = await (await get("r1")).json();
  expect(mockListEntriesInWindow).toHaveBeenCalledWith({ sceneId: "main", from: new Date(T(98)), to: new Date(T(698)) });
  expect(body.items[0]).toMatchObject({ offsetMs: 0, endOffsetMs: 102_000, clippedStart: false });
});

it("falls back to the worker's go-live stamp when YouTube's instants aren't stamped yet", async () => {
  mockGetRun.mockResolvedValue(run({ platforms: { youtube: { broadcastId: "vid1", watchUrl: "https://youtu.be/vid1" } } }));
  const body = await (await get("r1")).json();
  expect(body.video.base).toEqual({ baseMs: T(100), source: "run" });
  expect(body.window).toEqual({ fromMs: T(100), toMs: T(700) });
});

it("keeps a live run's window open and its on-air shot unclosed", async () => {
  mockGetRun.mockResolvedValue(run({ status: "live", endedAt: null, platforms: { youtube: { broadcastId: "vid1", actualStartTime: T(103) } } }));
  mockListEntriesInWindow.mockResolvedValue([entry("a", 103, 150), entry("b", 150, null)]);
  const body = await (await get("r1")).json();
  expect(body.window.fromMs).toBe(T(103));
  expect(body.window.toMs).toBeNull();
  expect(body.items).toHaveLength(2);
  expect(body.items[1]).toMatchObject({ offsetMs: 47_000, endOffsetMs: null, clippedEnd: false });
});

it("returns an empty bundle for a run that never went live, without querying the log", async () => {
  mockGetRun.mockResolvedValue(run({ status: "failed", startAt: null, endedAt: null, platforms: { youtube: { broadcastId: "vid1" } } }));
  const body = await (await get("r1")).json();
  expect(body.window).toBeNull();
  expect(body.items).toEqual([]);
  expect(mockListEntriesInWindow).not.toHaveBeenCalled();
});

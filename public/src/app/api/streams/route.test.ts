/** @jest-environment node */
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToFore: jest.fn() }));

const db = {
  listRuns: jest.fn(async () => [
    { id: "r1", sceneId: "default", encoderId: "gpu-1", status: "live", title: "Main", platforms: {} },
    { id: "r2", sceneId: "shorts", encoderId: "obs-v1", status: "live", title: "Europe round-up", platforms: {}, script: { scriptId: "s", renderId: "x" } },
  ]),
  listYoutubeAccounts: jest.fn(async () => []),
  listStreamEncoders: jest.fn(async () => [
    { id: "gpu-1", url: "ws://a", enabled: true, sceneId: "default" },
    { id: "obs-v1", url: "ws://b", enabled: true, use: "videos" },
    { id: "obs-v2", url: "ws://c", enabled: true, use: "videos" },
  ]),
  listStreamSlots: jest.fn(async () => []),
  shortRenders: { list: jest.fn(async () => [{ id: "y", encoderId: "obs-v1", status: "queued" }]) },
  shortSchedules: { list: jest.fn(async (): Promise<any[]> => []) },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { requireAdmin } from "../../../lib/require-admin";
import { GET } from "./route";

beforeEach(() => {
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("returns each encoder's use and occupancy in the snapshot (short-video plan §6.2)", async () => {
  const res = await (GET as () => Promise<Response>)();
  expect(res.status).toBe(200);
  const body = await res.json();
  const byId = Object.fromEntries(body.encoders.map((e: any) => [e.id, e]));
  expect(byId["gpu-1"]).toMatchObject({ use: "channels", occupancy: { state: "live", canQueueVideo: false } });
  expect(byId["obs-v1"]).toMatchObject({ use: "videos", occupancy: { state: "rendering", label: "rendering: Europe round-up, 1 more queued" } });
  expect(byId["obs-v2"].occupancy).toMatchObject({ state: "free", label: "free" });
  expect(db.shortRenders.list).toHaveBeenCalledWith({ status: ["queued", "preparing", "live"] });
});

it("still answers when the render queue can't be read", async () => {
  db.shortRenders.list.mockRejectedValueOnce(new Error("mongo"));
  const res = await (GET as () => Promise<Response>)();
  expect(res.status).toBe(200);
  expect((await res.json()).encoders).toHaveLength(3);
});

it("shows a schedule booked on a named encoder within 24 h as booked; 'any' books none", async () => {
  const soon = Date.now() + 2 * 3_600_000;
  db.shortSchedules.list.mockResolvedValueOnce([
    { id: "morning", name: "Morning batch", enabled: true, encoderId: "obs-v2", nextAt: soon },
    { id: "pool", name: "Any", enabled: true, encoderId: "any", nextAt: soon },
  ]);
  const body = await (await (GET as () => Promise<Response>)()).json();
  const byId = Object.fromEntries(body.encoders.map((e: any) => [e.id, e]));
  expect(byId["obs-v2"].occupancy).toMatchObject({ state: "booked", scheduleId: "morning", bookedAt: soon });
  expect(byId["obs-v1"].occupancy.state).toBe("rendering");
});

it("still answers when the schedules can't be read", async () => {
  db.shortSchedules.list.mockRejectedValueOnce(new Error("mongo"));
  const res = await (GET as () => Promise<Response>)();
  expect(res.status).toBe(200);
  expect((await res.json()).encoders.find((e: any) => e.id === "obs-v2").occupancy.state).toBe("free");
});

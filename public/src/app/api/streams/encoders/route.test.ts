/** @jest-environment node */

/** POST /api/streams/encoders — an encoder's use (short-video plan §6.6). */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = { saveStreamEncoder: jest.fn(async (p: Record<string, unknown>) => ({ enabled: true, ...p })), listStreamEncoders: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x/api/streams/encoders", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("assigning an encoder to videos unbinds it from its channel", async () => {
  const res = await post({ id: "obs-v1", url: "ws://a", use: "videos", sceneId: "wind" });
  expect(res.status).toBe(200);
  expect(mockDb.saveStreamEncoder).toHaveBeenCalledWith(expect.objectContaining({ id: "obs-v1", use: "videos", sceneId: null }));
  expect((await res.json()).use).toBe("videos");
});

it("assigning to channels keeps the binding sent", async () => {
  await post({ id: "obs-1", url: "ws://a", use: "channels", sceneId: "wind" });
  expect(mockDb.saveStreamEncoder).toHaveBeenCalledWith(expect.objectContaining({ use: "channels", sceneId: "wind" }));
});

it("refuses an unknown use", async () => {
  expect((await post({ id: "x", url: "ws://a", use: "toaster" })).status).toBe(400);
  expect(mockDb.saveStreamEncoder).not.toHaveBeenCalled();
});

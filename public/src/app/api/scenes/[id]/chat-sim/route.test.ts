/** @jest-environment node */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToFore: jest.fn() }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { POST } from "./route";
import { POST as CLEAR } from "../viewer/clear/route";

const params = { params: Promise.resolve({ id: "wind" }) };
const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), params);

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
});

it("is admin only", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post({ text: ":skip" })).status).toBe(401);
  expect((await CLEAR(new Request("http://x", { method: "POST" }), params)).status).toBe(401);
  expect(sendToFore).not.toHaveBeenCalled();
});

it("needs some text", async () => {
  expect((await post({ text: "   " })).status).toBe(400);
});

it("hands the message to the worker's simulator, defaulting the author", async () => {
  expect((await post({ text: ":music deep", isMod: true })).status).toBe(202);
  expect(sendToFore).toHaveBeenCalledWith("scenes", "viewer-chat", "inject", { sceneId: "wind", author: "viewer", text: ":music deep", isMod: true });
});

it("asks the worker to clear the scene's picks", async () => {
  expect((await CLEAR(new Request("http://x", { method: "POST" }), params)).status).toBe(202);
  expect(sendToFore).toHaveBeenCalledWith("scenes", "viewer-chat", "clear", { sceneId: "wind" });
});

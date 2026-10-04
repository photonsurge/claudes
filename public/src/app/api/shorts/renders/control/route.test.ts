/** @jest-environment node */

/** POST /api/shorts/renders/control — the §6.7 controls, handed to the worker's render queue. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToQueueAndWait: jest.fn() }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/shorts/renders/control", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post({ action: "pause", encoderId: "v1" })).status).toBe(401);
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it.each([
  [{ action: "explode", renderId: "r" }, /action must be/],
  [{ action: "pause" }, /encoderId/],
  [{ action: "stop" }, /renderId/],
])("400s %j", async (body, msg) => {
  const res = await post(body);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(msg);
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it("pauses an encoder's queue through the worker", async () => {
  (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: true });
  const res = await post({ action: "pause", encoderId: " v1 ", renderId: "ignored" });
  expect(res.status).toBe(200);
  expect(sendToQueueAndWait).toHaveBeenCalledWith("stream", "run-lifecycle", "renderControl", { action: "pause", encoderId: "v1" }, expect.any(Number), undefined, { dedupe: false });
});

it.each(["cancel", "retry", "stop"])("%s goes to the worker with the render id", async (action) => {
  (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: true, render: { id: "r1" } });
  const res = await post({ action, renderId: "r1" });
  expect(res.status).toBe(200);
  expect((sendToQueueAndWait as jest.Mock).mock.calls[0][3]).toEqual({ action, renderId: "r1" });
});

it("a refusal comes back as 409 with the worker's reason", async () => {
  (sendToQueueAndWait as jest.Mock).mockResolvedValue({ ok: false, error: "only a queued video can be cancelled (this one is live)" });
  const res = await post({ action: "cancel", renderId: "r1" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/only a queued video/);
});

it("504s when the worker doesn't answer", async () => {
  (sendToQueueAndWait as jest.Mock).mockRejectedValue(new Error("timed out before finishing"));
  expect((await post({ action: "resume", encoderId: "v1" })).status).toBe(504);
});

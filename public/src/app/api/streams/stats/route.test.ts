/** @jest-environment node */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToQueueAndWait: jest.fn() }));
import { requireAdmin } from "../../../../lib/require-admin";
import { sendToQueueAndWait } from "@photonsurge/shared/bull/bull-queue";
import { GET } from "./route";

const get = () => GET();
beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("rejects anonymous requests before enqueueing work", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(false);
  expect((await get()).status).toBe(401);
  expect(sendToQueueAndWait).not.toHaveBeenCalled();
});

it("returns the worker's counters without browser caching", async () => {
  const stats = { r1: { views: "20", likes: "0", fetchedAt: 123 } };
  (sendToQueueAndWait as jest.Mock).mockResolvedValue(stats);
  const response = await get();
  expect(await response.json()).toEqual({ stats });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(sendToQueueAndWait).toHaveBeenCalledWith("stream", "youtube", "videoStats", {}, 25_000);
});

it("reports worker failures without leaking internal errors", async () => {
  (sendToQueueAndWait as jest.Mock).mockRejectedValue(new Error("internal connection details"));
  const response = await get();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "YouTube stats temporarily unavailable" });
});

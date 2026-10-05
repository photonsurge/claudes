/** @jest-environment node */

/** POST /api/crossword/suggest — admin only; queues `crossword.suggest` on the background lane. */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToBack: jest.fn() }));

import { requireAdmin } from "../../../../lib/require-admin";
import { sendToBack } from "@photonsurge/shared/bull/bull-queue";
import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
});

it("is admin only", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post({ wordId: "a" })).status).toBe(401);
  expect(sendToBack).not.toHaveBeenCalled();
});

it("queues one word", async () => {
  const res = await post({ wordId: "a" });
  expect(res.status).toBe(202);
  expect(await res.json()).toEqual({ queued: true, count: 1 });
  expect(sendToBack).toHaveBeenCalledWith("crossword", "crossword", "suggest", { wordIds: ["a"] });
});

it("queues a batch, de-duplicated", async () => {
  expect((await post({ wordIds: ["a", "b", "a"] })).status).toBe(202);
  expect(sendToBack).toHaveBeenCalledWith("crossword", "crossword", "suggest", { wordIds: ["a", "b"] });
});

it("rejects a missing, malformed or oversized payload", async () => {
  for (const body of [{}, "not json", { wordIds: [] }, { wordId: 3 }, { wordIds: ["a", ""] }, { wordIds: Array.from({ length: 51 }, (_, i) => `w${i}`) }]) {
    expect((await post(body)).status).toBe(400);
  }
  expect(sendToBack).not.toHaveBeenCalled();
  expect((await post({ wordIds: Array.from({ length: 50 }, (_, i) => `w${i}`) })).status).toBe(202);
});

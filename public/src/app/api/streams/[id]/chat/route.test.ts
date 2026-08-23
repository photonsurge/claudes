/** @jest-environment node */

/**
 * GET /api/streams/:id/chat — admin-gated chat-log history. Worth pinning: the
 * 401 for non-admins (chat is operator-only, and this route is what the
 * cold-start seed + /admin/streams dialog hit) and the `since` passthrough.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockRequireAdmin = jest.fn();
jest.mock("../../../../../lib/require-admin", () => ({
  requireAdmin: (...a: unknown[]) => mockRequireAdmin(...a),
}));

const mockListForRun = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({ chatLog: { listForRun: (...a: unknown[]) => mockListForRun(...a) } }),
}));

import { GET } from "./route";

const get = (id: string, qs = "") =>
  GET(new Request(`http://x/api/streams/${id}/chat${qs}`) as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
  mockRequireAdmin.mockReset().mockResolvedValue(true);
  mockListForRun.mockReset().mockResolvedValue([]);
});

it("401s for non-admins without touching the db", async () => {
  mockRequireAdmin.mockResolvedValue(false);
  const res = await get("r1");
  expect(res.status).toBe(401);
  expect(mockListForRun).not.toHaveBeenCalled();
});

it("returns the run's logged messages", async () => {
  const messages = [{ id: "m1", runId: "r1", author: "ann", text: "hi", ts: 1 }];
  mockListForRun.mockResolvedValue(messages);
  const res = await get("r1");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ messages });
  expect(mockListForRun).toHaveBeenCalledWith("r1", { since: undefined });
});

it("forwards a positive ?since and ignores a junk one", async () => {
  await get("r1", "?since=123");
  expect(mockListForRun).toHaveBeenLastCalledWith("r1", { since: 123 });
  await get("r1", "?since=banana");
  expect(mockListForRun).toHaveBeenLastCalledWith("r1", { since: undefined });
});

/** @jest-environment node */

/**
 * Plan §7.5, §8.4, §9 — POST /api/crossword/generate: admin only, withApiLog,
 * and it enqueues `crossword.generate` on the background tier with { sceneId }
 * and nothing else. Public holds no game logic: it builds nothing itself.
 */
jest.mock("../../../../lib/api-log", () => ({
  withApiLog: (h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true }),
}));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToBack: jest.fn(), sendToFore: jest.fn() }));
const mockDb = {
  crosswordScenes: jest.fn(),
  crosswordPuzzles: { upsert: jest.fn(), create: jest.fn(), insert: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { sendToBack, sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../lib/require-admin";
import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordScenes.mockResolvedValue(["xw"]);
});

it("is wrapped in withApiLog", () => {
  expect((POST as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("401s a non-admin and queues nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post({ sceneId: "xw" })).status).toBe(401);
  expect(sendToBack).not.toHaveBeenCalled();
  expect(sendToFore).not.toHaveBeenCalled();
});

it("queues crossword.generate on the background tier with { sceneId } only", async () => {
  const res = await post({ sceneId: "xw", seed: 7, entries: [{ answer: "CAT" }], approve: true });
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  expect(sendToFore).not.toHaveBeenCalled();
  expect(sendToBack).toHaveBeenCalledTimes(1);
  const [domain, type, job, data] = (sendToBack as jest.Mock).mock.calls[0];
  expect(`${type}.${job}`).toBe("crossword.generate");
  expect(domain).toBe("crossword");
  expect(data).toEqual({ sceneId: "xw" });
  expect(mockDb.crosswordPuzzles.upsert).not.toHaveBeenCalled();
  expect(mockDb.crosswordPuzzles.create).not.toHaveBeenCalled();
  expect(mockDb.crosswordPuzzles.insert).not.toHaveBeenCalled();
});

it.each([[{}], [{ sceneId: "" }], [{ sceneId: 42 }]])("refuses %j and queues nothing", async (body) => {
  const res = await post(body);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect(sendToBack).not.toHaveBeenCalled();
});

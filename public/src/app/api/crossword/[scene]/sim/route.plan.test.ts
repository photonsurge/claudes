/** @jest-environment node */

/**
 * Plan §8.3, §8.4, §9 — POST /api/crossword/:scene/sim: admin only, withApiLog,
 * name and text each at most 40 characters, and `crossword.inject` with a sim
 * message on the foreground tier. The scene comes from the path.
 */
jest.mock("../../../../../lib/api-log", () => ({
  withApiLog: (h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true }),
}));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToFore: jest.fn(), sendToBack: jest.fn() }));
const mockDb = { crosswordScenes: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { sendToBack, sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { requireAdmin } from "../../../../../lib/require-admin";
import { POST } from "./route";

const post = (body: unknown, scene = "xw") =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ scene }) });

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
  expect((await post({ name: "Ann", text: "cat" })).status).toBe(401);
  expect(sendToFore).not.toHaveBeenCalled();
});

it("queues crossword.inject on the foreground tier, marked sim, for the path's scene", async () => {
  const res = await post({ name: "Ann", text: "1a cat", sceneId: "other", kind: "command", command: "nextPuzzle" });
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  expect(sendToBack).not.toHaveBeenCalled();
  expect(sendToFore).toHaveBeenCalledTimes(1);
  const [domain, type, job, data] = (sendToFore as jest.Mock).mock.calls[0];
  expect(domain).toBe("crossword");
  expect(`${type}.${job}`).toBe("crossword.inject");
  expect(data).toMatchObject({ sceneId: "xw", kind: "sim", name: "Ann", text: "1a cat" });
  expect(data).not.toHaveProperty("command");
});

it("accepts a name and text of exactly 40 characters", async () => {
  expect((await post({ name: "n".repeat(40), text: "t".repeat(40) })).status).toBeLessThan(300);
  expect(sendToFore).toHaveBeenCalledTimes(1);
});

it.each([
  ["no name", { text: "cat" }],
  ["no text", { name: "Ann" }],
  ["a 41-character name", { name: "n".repeat(41), text: "cat" }],
  ["a 41-character text", { name: "Ann", text: "t".repeat(41) }],
  ["a non-string text", { name: "Ann", text: 7 }],
])("refuses %s and queues nothing", async (_l, body) => {
  const res = await post(body);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect(sendToFore).not.toHaveBeenCalled();
});

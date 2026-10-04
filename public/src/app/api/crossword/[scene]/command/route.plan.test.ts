/** @jest-environment node */

/**
 * Plan §8.3, §8.4, §9 — POST /api/crossword/:scene/command: admin only,
 * withApiLog, and `crossword.inject` on the foreground tier with one of
 * pause, resume, skipClue, reveal or nextPuzzle.
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
  expect((await post({ command: "pause" })).status).toBe(401);
  expect(sendToFore).not.toHaveBeenCalled();
});

it.each(["pause", "resume", "skipClue", "reveal", "nextPuzzle"])("queues %s as crossword.inject on the foreground tier", async (command) => {
  const res = await post({ command });
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
  expect(sendToBack).not.toHaveBeenCalled();
  expect(sendToFore).toHaveBeenCalledTimes(1);
  const [domain, type, job, data] = (sendToFore as jest.Mock).mock.calls[0];
  expect(domain).toBe("crossword");
  expect(`${type}.${job}`).toBe("crossword.inject");
  expect(data).toEqual({ sceneId: "xw", kind: "command", command });
});

it.each([[{}], [{ command: "stop" }], [{ command: "approve" }], [{ command: "PAUSE" }], [{ command: ["pause"] }], [{ text: "pause" }]])(
  "refuses %j and queues nothing",
  async (body) => {
    const res = await post(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(sendToFore).not.toHaveBeenCalled();
  },
);

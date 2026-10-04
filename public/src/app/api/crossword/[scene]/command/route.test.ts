/** @jest-environment node */

/**
 * POST /api/crossword/:scene/command — admin only, the command must be one of
 * CROSSWORD_COMMANDS, and it goes to the worker as a `crossword.inject`.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToFore: jest.fn() }));
const mockDb = { crosswordScenes: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { CROSSWORD_COMMANDS } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../../lib/require-admin";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";
import { POST } from "./route";

const params = (scene = "xw") => ({ params: Promise.resolve({ scene }) });
const post = (body: unknown, scene?: string) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), params(scene));

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordScenes.mockResolvedValue(["xw"]);
});

it("is admin only", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post({ command: "pause" })).status).toBe(401);
  expect(sendToFore).not.toHaveBeenCalled();
});

it.each([[{}], [{ command: "explode" }], [{ command: 3 }]])("400s %j", async (body) => {
  const res = await post(body);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(/pause, resume, skipClue, reveal, nextPuzzle/);
  expect(sendToFore).not.toHaveBeenCalled();
});

it("404s a scene that isn't a crossword channel", async () => {
  expect((await post({ command: "pause" }, "wind")).status).toBe(404);
});

it.each(CROSSWORD_COMMANDS.map((c) => [c]))("queues %s", async (command) => {
  expect((await post({ command })).status).toBe(202);
  expect(sendToFore).toHaveBeenCalledWith("crossword", "crossword", "inject", { sceneId: "xw", kind: "command", command });
});

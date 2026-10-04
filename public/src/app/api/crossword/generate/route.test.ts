/** @jest-environment node */

/** POST /api/crossword/generate — admin only; queues `crossword.generate` on the background lane. */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToBack: jest.fn() }));
const mockDb = { crosswordScenes: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { sendToBack } from "@photonsurge/shared/bull/bull-queue";
import { POST } from "./route";

const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordScenes.mockResolvedValue(["xw"]);
});

it("is admin only", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post({ sceneId: "xw" })).status).toBe(401);
  expect(sendToBack).not.toHaveBeenCalled();
});

it("needs a crossword sceneId and a short theme", async () => {
  expect((await post({})).status).toBe(400);
  expect((await post({ sceneId: "xw", theme: "t".repeat(61) })).status).toBe(400);
  expect((await post({ sceneId: "wind" })).status).toBe(404);
  expect(sendToBack).not.toHaveBeenCalled();
});

it("queues a build (a theme in the body is ignored: puzzles have none)", async () => {
  expect((await post({ sceneId: "xw" })).status).toBe(202);
  expect(sendToBack).toHaveBeenLastCalledWith("crossword", "crossword", "generate", { sceneId: "xw" });
  await post({ sceneId: "xw", theme: "  Volcanoes   of  Iceland " });
  expect(sendToBack).toHaveBeenLastCalledWith("crossword", "crossword", "generate", { sceneId: "xw" });
  await post({ sceneId: "xw", theme: "   " });
  expect(sendToBack).toHaveBeenLastCalledWith("crossword", "crossword", "generate", { sceneId: "xw" });
});

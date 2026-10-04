/** @jest-environment node */

/**
 * POST /api/crossword/:scene/sim — the Desk's "say as viewer": admin only,
 * name and text validated, and a `crossword.inject` sim payload on the
 * foreground lane for a crossword channel only.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToFore: jest.fn() }));
const mockDb = { crosswordScenes: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

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
  expect((await post({ name: "rich", text: "crater" })).status).toBe(401);
  expect(sendToFore).not.toHaveBeenCalled();
});

it.each([
  [{ text: "crater" }, /name is required/],
  [{ name: "   ", text: "crater" }, /name is required/],
  [{ name: "x".repeat(41), text: "crater" }, /name is at most 40/],
  [{ name: "rich" }, /text is required/],
  [{ name: "rich", text: "y".repeat(41) }, /text is at most 40/],
])("400s %j", async (body, msg) => {
  const res = await post(body);
  expect(res.status).toBe(400);
  expect((await res.json()).error).toMatch(msg);
  expect(sendToFore).not.toHaveBeenCalled();
});

it("404s a scene that isn't a crossword channel", async () => {
  expect((await post({ name: "rich", text: "crater" }, "wind")).status).toBe(404);
  expect(sendToFore).not.toHaveBeenCalled();
});

it("queues a sim inject stamped with the time it was typed", async () => {
  jest.spyOn(Date, "now").mockReturnValue(1234);
  const res = await post({ name: " rich ", text: " 7a crater " });
  expect(res.status).toBe(202);
  expect(sendToFore).toHaveBeenCalledWith("crossword", "crossword", "inject", {
    sceneId: "xw",
    kind: "sim",
    name: "rich",
    text: "7a crater",
    at: 1234,
  });
  jest.restoreAllMocks();
});

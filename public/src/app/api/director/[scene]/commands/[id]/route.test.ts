/** @jest-environment node */
jest.mock("../../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));
const mockDb = { directorCommands: { get: jest.fn(), drop: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../../../lib/require-admin";
import { DELETE } from "./route";

const del = (scene: string, id: string) => DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ scene, id }) });

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op@x" });
});

it("rejects anonymous requests", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await del("wind", "c1")).status).toBe(401);
});

it("won't drop another scene's command", async () => {
  mockDb.directorCommands.get.mockResolvedValue({ id: "c1", sceneId: "other" });
  expect((await del("wind", "c1")).status).toBe(404);
  expect(mockDb.directorCommands.drop).not.toHaveBeenCalled();
});

it("drops a queued command, 409 when it had already settled", async () => {
  mockDb.directorCommands.get.mockResolvedValue({ id: "c1", sceneId: "wind" });
  mockDb.directorCommands.drop.mockResolvedValue(true);
  expect((await del("wind", "c1")).status).toBe(200);
  mockDb.directorCommands.drop.mockResolvedValue(false);
  expect((await del("wind", "c1")).status).toBe(409);
});

/** @jest-environment node */

/** POST /api/shorts/stop — sets the PREVIEW scene's director to off, nothing else. */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockSave = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ saveDirectorConfig: mockSave }) }));

import { requireAdmin } from "../../../../lib/require-admin";
import { POST } from "./route";

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins without writing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await POST()).status).toBe(401);
  expect(mockSave).not.toHaveBeenCalled();
});

it("turns the preview scene's director off", async () => {
  const res = await POST();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, sceneId: "shorts-preview" });
  expect(mockSave).toHaveBeenCalledWith("shorts-preview", { mode: "off" });
});

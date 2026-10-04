/** @jest-environment node */

/** POST /api/shorts/stop — sets a FORMAT scene's director to off, nothing else. */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  saveDirectorConfig: jest.fn(),
  shortScripts: { get: jest.fn() },
  shortFormats: { get: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { POST } from "./route";

const post = (body?: unknown) =>
  POST(new Request("http://x/api/shorts/stop", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }));

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
});

it("401s for non-admins without writing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post()).status).toBe(401);
  expect(mockDb.saveDirectorConfig).not.toHaveBeenCalled();
});

it("with no body, turns the default format's scene off", async () => {
  const res = await post();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, sceneId: "shorts" });
  expect(mockDb.saveDirectorConfig).toHaveBeenCalledWith("shorts", { mode: "off" });
});

it("stops the script's format scene", async () => {
  mockDb.shortScripts.get.mockResolvedValue({ id: "s1", formatId: "short-uk" });
  expect(await (await post({ scriptId: "s1" })).json()).toEqual({ ok: true, sceneId: "short-uk" });
  expect(mockDb.saveDirectorConfig).toHaveBeenCalledWith("short-uk", { mode: "off" });
  mockDb.shortScripts.get.mockResolvedValue(null);
  expect((await post({ scriptId: "nope" })).status).toBe(404);
});

it("stops a named format's scene, but never a scene that isn't a format's", async () => {
  mockDb.shortFormats.get.mockImplementation(async (id: string) => (id === "short-uk" ? { id } : null));
  expect(await (await post({ formatId: "short-uk" })).json()).toEqual({ ok: true, sceneId: "short-uk" });
  expect((await post({ formatId: "default" })).status).toBe(404);
  expect(mockDb.saveDirectorConfig).toHaveBeenCalledTimes(1);
});

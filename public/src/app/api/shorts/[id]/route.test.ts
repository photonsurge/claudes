/** @jest-environment node */

/** GET / DELETE /api/shorts/:id — one script; deleting stops a preview playing it. */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  shortScripts: { get: jest.fn(), remove: jest.fn() },
  getOrInitDirectorConfig: jest.fn(),
  saveDirectorConfig: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { DELETE, GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string) => new Request("http://x/api/shorts/s1", { method });

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
  mockDb.getOrInitDirectorConfig.mockResolvedValue({ mode: "off" });
});

it("401s for non-admins", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(req("GET"), ctx("s1"))).status).toBe(401);
  expect((await DELETE(req("DELETE"), ctx("s1"))).status).toBe(401);
  expect(mockDb.shortScripts.remove).not.toHaveBeenCalled();
});

it("GET returns the script, or 404", async () => {
  mockDb.shortScripts.get.mockResolvedValueOnce({ id: "s1", title: "T", clips: [] }).mockResolvedValueOnce(null);
  const ok = await GET(req("GET"), ctx("s1"));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ id: "s1", title: "T", clips: [] });
  expect((await GET(req("GET"), ctx("nope"))).status).toBe(404);
});

it("DELETE removes the script, 404 when unknown", async () => {
  mockDb.shortScripts.remove.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await DELETE(req("DELETE"), ctx("s1"))).status).toBe(200);
  expect(mockDb.shortScripts.remove).toHaveBeenCalledWith("s1");
  expect(mockDb.saveDirectorConfig).not.toHaveBeenCalled();
  expect((await DELETE(req("DELETE"), ctx("nope"))).status).toBe(404);
});

it("DELETE stops the preview scene first when it is playing that script", async () => {
  mockDb.getOrInitDirectorConfig.mockResolvedValue({ mode: "script", script: { scriptId: "s1", fromClip: 0, playNonce: 1, record: false } });
  mockDb.shortScripts.remove.mockResolvedValue(true);
  await DELETE(req("DELETE"), ctx("s1"));
  expect(mockDb.saveDirectorConfig).toHaveBeenCalledWith("shorts-preview", { mode: "off" });
});

/** @jest-environment node */

/**
 * GET/PUT/DELETE /api/shorts/formats/:id — PUT sanitises onto the stored
 * format (a partial body is a patch, the id is the URL's); DELETE refuses the
 * default format and a format scripts use, saying how many.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  shortFormats: { get: jest.fn(), upsert: jest.fn(), remove: jest.fn() },
  shortScripts: { countByFormat: jest.fn() },
  shortRenders: { countByFormat: jest.fn() },
  shortSchedules: { countByFormat: jest.fn() },
  getScene: jest.fn(),
  setSceneMeta: jest.fn(),
  deleteScene: jest.fn(),
  deleteDirectorConfig: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { defaultShortFormat } from "@photonsurge/shared/short-format";
import { DELETE, GET, PUT } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://x/api/shorts/formats/x", { method, body: body === undefined ? undefined : JSON.stringify(body) });
const uk = defaultShortFormat("short-uk", "UK");

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
  mockDb.shortFormats.get.mockImplementation(async (id: string) => (id === "short-uk" ? uk : id === "shorts" ? defaultShortFormat() : null));
  mockDb.shortFormats.upsert.mockImplementation(async (f: unknown) => f);
  mockDb.shortScripts.countByFormat.mockResolvedValue(0);
  mockDb.shortRenders.countByFormat.mockResolvedValue(0);
  mockDb.shortSchedules.countByFormat.mockResolvedValue(0);
  mockDb.getScene.mockResolvedValue({ id: "short-uk", name: "UK" });
});

it("401s for non-admins", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(req("GET"), ctx("short-uk"))).status).toBe(401);
  expect((await PUT(req("PUT", {}), ctx("short-uk"))).status).toBe(401);
  expect((await DELETE(req("DELETE"), ctx("short-uk"))).status).toBe(401);
  expect(mockDb.shortFormats.remove).not.toHaveBeenCalled();
});

it("GET returns the format, or 404", async () => {
  expect(await (await GET(req("GET"), ctx("short-uk"))).json()).toEqual(uk);
  expect((await GET(req("GET"), ctx("nope"))).status).toBe(404);
});

it("PUT patches onto the stored format, keeps the URL's id and renames the scene", async () => {
  const res = await PUT(req("PUT", { id: "hijack", name: "UK daily", close: { enabled: false }, opener: { budgetShare: "lots" } }), ctx("short-uk"));
  expect(res.status).toBe(200);
  const saved = await res.json();
  expect(saved).toEqual({ ...uk, name: "UK daily", close: { ...uk.close, enabled: false } });
  expect(mockDb.shortFormats.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: "short-uk" }));
  expect(mockDb.setSceneMeta).toHaveBeenCalledWith("short-uk", { name: "UK daily" });
});

it("PUT 404s an unknown format and 400s a non-JSON body", async () => {
  expect((await PUT(req("PUT", {}), ctx("nope"))).status).toBe(404);
  const bad = new Request("http://x", { method: "PUT", body: "{" });
  expect((await PUT(bad, ctx("short-uk"))).status).toBe(400);
  expect(mockDb.shortFormats.upsert).not.toHaveBeenCalled();
});

it("DELETE refuses the default format and one scripts use, saying how many", async () => {
  const def = await DELETE(req("DELETE"), ctx("shorts"));
  expect(def.status).toBe(400);
  mockDb.shortScripts.countByFormat.mockResolvedValue(2);
  const used = await DELETE(req("DELETE"), ctx("short-uk"));
  expect(used.status).toBe(409);
  expect(await used.json()).toEqual({ error: expect.stringMatching(/2 scripts use this format/), scripts: 2 });
  expect((await DELETE(req("DELETE"), ctx("nope"))).status).toBe(404);
  expect(mockDb.shortFormats.remove).not.toHaveBeenCalled();
});

it("DELETE refuses a format with videos queued or rendering in it, saying how many", async () => {
  mockDb.shortRenders.countByFormat.mockResolvedValue(1);
  const res = await DELETE(req("DELETE"), ctx("short-uk"));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: expect.stringMatching(/1 video is queued or rendering/), renders: 1 });
  expect(mockDb.shortFormats.remove).not.toHaveBeenCalled();
});

it("DELETE refuses a format a schedule makes videos in, saying how many", async () => {
  mockDb.shortSchedules.countByFormat.mockResolvedValue(2);
  const res = await DELETE(req("DELETE"), ctx("short-uk"));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: expect.stringMatching(/2 schedules make videos in this format/), schedules: 2 });
  expect(mockDb.shortFormats.remove).not.toHaveBeenCalled();
});

it("DELETE removes the settings, the scene and its director config", async () => {
  const res = await DELETE(req("DELETE"), ctx("short-uk"));
  expect(res.status).toBe(200);
  expect(mockDb.shortFormats.remove).toHaveBeenCalledWith("short-uk");
  expect(mockDb.deleteScene).toHaveBeenCalledWith("short-uk");
  expect(mockDb.deleteDirectorConfig).toHaveBeenCalledWith("short-uk");
});

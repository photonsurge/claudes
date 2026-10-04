/** @jest-environment node */

/**
 * POST /api/shorts/:id/play — starts an editor preview on the script's FORMAT
 * scene: mode script, fresh nonce, record off, fromClip clamped.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  shortScripts: { get: jest.fn() },
  getScene: jest.fn(),
  getOrInitDirectorConfig: jest.fn(),
  saveDirectorConfig: jest.fn(),
  shortRenders: { countByFormat: jest.fn() },
  activeRunForScene: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { POST } from "./route";

const post = (id: string, body?: unknown) =>
  POST(new Request(`http://x/api/shorts/${id}/play`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const script = { id: "s1", title: "T", clips: [{ id: "a" }, { id: "b" }, { id: "c" }] };

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(true);
  mockDb.shortScripts.get.mockResolvedValue(script);
  mockDb.getScene.mockResolvedValue({ id: "shorts" });
  mockDb.getOrInitDirectorConfig.mockResolvedValue({ mode: "off" });
  mockDb.shortRenders.countByFormat.mockResolvedValue(0);
  mockDb.activeRunForScene.mockResolvedValue(null);
});

it("409s while a render of the script's format is preparing or live, saying why (§5.3)", async () => {
  mockDb.shortScripts.get.mockResolvedValue({ ...script, formatId: "short-uk" });
  mockDb.shortRenders.countByFormat.mockResolvedValue(1);
  const res = await post("s1");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/a video is rendering in this format/);
  expect(mockDb.shortRenders.countByFormat).toHaveBeenCalledWith("short-uk", ["preparing", "live"]);
  expect(mockDb.saveDirectorConfig).not.toHaveBeenCalled();
});

it("409s while a render run is active on the format's scene, naming it; a channel run there doesn't block", async () => {
  mockDb.activeRunForScene.mockResolvedValue({ id: "run9", status: "live", title: "Europe round-up", script: { scriptId: "s2" } });
  const res = await post("s1");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/Europe round-up, live/);
  mockDb.activeRunForScene.mockResolvedValue({ id: "run8", status: "live" });
  expect((await post("s1")).status).toBe(200);
});

it("401s for non-admins without writing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await post("s1")).status).toBe(401);
  expect(mockDb.saveDirectorConfig).not.toHaveBeenCalled();
});

it("404s an unknown script", async () => {
  mockDb.shortScripts.get.mockResolvedValue(null);
  expect((await post("nope")).status).toBe(404);
});

it("400s a script with no clips", async () => {
  mockDb.shortScripts.get.mockResolvedValue({ ...script, clips: [] });
  expect((await post("s1")).status).toBe(400);
  expect(mockDb.saveDirectorConfig).not.toHaveBeenCalled();
});

it("409s with the seed instructions when the default format's scene doesn't exist", async () => {
  mockDb.getScene.mockResolvedValue(null);
  const res = await post("s1");
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/Seed default short format/);
  expect(mockDb.getScene).toHaveBeenCalledWith("shorts");
  expect(mockDb.saveDirectorConfig).not.toHaveBeenCalled();
});

it("plays on the script's own format scene", async () => {
  mockDb.shortScripts.get.mockResolvedValue({ ...script, formatId: "short-uk" });
  const body = await (await post("s1")).json();
  expect(body.sceneId).toBe("short-uk");
  expect(mockDb.getScene).toHaveBeenCalledWith("short-uk");
  expect(mockDb.saveDirectorConfig).toHaveBeenCalledWith("short-uk", expect.objectContaining({ mode: "script" }));
});

it("starts the play on the default format's scene with record off and a fresh nonce", async () => {
  const before = Date.now();
  const res = await post("s1", { fromClip: 1 });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, sceneId: "shorts", fromClip: 1 });
  expect(body.playNonce).toBeGreaterThanOrEqual(before);
  expect(mockDb.saveDirectorConfig).toHaveBeenCalledWith("shorts", {
    mode: "script",
    script: { scriptId: "s1", fromClip: 1, playNonce: body.playNonce, record: false },
  });
});

it("never reuses a nonce the scene already answered", async () => {
  const future = Date.now() + 1e9;
  mockDb.getOrInitDirectorConfig.mockResolvedValue({ mode: "off", script: { scriptId: "s1", fromClip: 0, playNonce: future, record: false } });
  const body = await (await post("s1")).json();
  expect(body.playNonce).toBe(future + 1);
});

it("clamps fromClip into the script and defaults to the top", async () => {
  expect((await (await post("s1", { fromClip: 99 })).json()).fromClip).toBe(2);
  expect((await (await post("s1", { fromClip: -4 })).json()).fromClip).toBe(0);
  expect((await (await post("s1")).json()).fromClip).toBe(0);
});

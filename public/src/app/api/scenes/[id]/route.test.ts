/** @jest-environment node */

/**
 * GET/PATCH/DELETE /api/scenes/:id — per-scene ControlState. The part worth
 * pinning: GET's dual-auth (admin session OR a matching ?token=, since /watch/:id
 * can't log in) and PATCH's merge semantics — `useScenePatcher` (public/src/lib/
 * scenes.ts) sends only a DELTA specifically so it can't clobber the operator's
 * live full state, which only holds if this route actually merges onto the
 * EXISTING doc rather than replacing it, and preserves the scene `name` (which
 * lives outside ControlState) across that merge.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockCookieGet = jest.fn();
jest.mock("next/headers", () => ({ cookies: async () => ({ get: mockCookieGet }) }));

const mockIsAdmin = jest.fn();
jest.mock("@photonsurge/shared/utill/session", () => ({
  SESSION_COOKIE: "wc_session",
  readSession: (t: string) => ({ token: t }),
  isAdmin: (...a: unknown[]) => mockIsAdmin(...a),
}));

const mockGetOrInit = jest.fn();
const mockGetScene = jest.fn();
const mockDeleteScene = jest.fn();
const mockDeleteDirectorConfig = jest.fn();
const mockUpsertByID = jest.fn();
const mockDeleteCrossword = jest.fn();
const mockGetFormat = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getOrInitBroadcastState: (...a: unknown[]) => mockGetOrInit(...a),
    getScene: (...a: unknown[]) => mockGetScene(...a),
    deleteScene: (...a: unknown[]) => mockDeleteScene(...a),
    deleteDirectorConfig: (...a: unknown[]) => mockDeleteDirectorConfig(...a),
    deleteCrosswordScene: (...a: unknown[]) => mockDeleteCrossword(...a),
    shortFormats: { get: (...a: unknown[]) => mockGetFormat(...a) },
    broadcastState: { upsertByID: (...a: unknown[]) => mockUpsertByID(...a) },
  }),
}));

import { GET, PATCH, DELETE } from "./route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const getReq = (url: string) => GET(new Request(url) as never, params(new URL(url).pathname.split("/").pop()!));
const patchReq = (id: string, body: unknown) =>
  PATCH(new Request(`http://x/api/scenes/${id}`, { method: "PATCH", body: JSON.stringify(body) }) as never, params(id));
const deleteReq = (id: string) =>
  DELETE(new Request(`http://x/api/scenes/${id}`, { method: "DELETE" }) as never, params(id));

beforeEach(() => {
  mockCookieGet.mockReset().mockReturnValue(undefined);
  mockIsAdmin.mockReset().mockReturnValue(false);
  mockGetOrInit.mockReset().mockResolvedValue(null);
  mockGetScene.mockReset().mockResolvedValue(null);
  mockDeleteScene.mockReset();
  mockDeleteDirectorConfig.mockReset();
  mockUpsertByID.mockReset();
  mockDeleteCrossword.mockReset();
  mockGetFormat.mockReset().mockResolvedValue(null);
});

describe("GET /api/scenes/:id", () => {
  it("404s when the scene doesn't exist", async () => {
    const res = await getReq("http://x/api/scenes/atlantic");
    expect(res.status).toBe(404);
  });

  it("401s with no session and no/wrong watch token", async () => {
    mockGetScene.mockResolvedValue({ watchToken: "abc123" });
    expect((await getReq("http://x/api/scenes/atlantic")).status).toBe(401);
    expect((await getReq("http://x/api/scenes/atlantic?token=wrong")).status).toBe(401);
  });

  it("200s for the matching watch token (no session — the /watch:id case)", async () => {
    mockGetScene.mockResolvedValue({ watchToken: "abc123", showWind: false });
    const res = await getReq("http://x/api/scenes/atlantic?token=abc123");
    expect(res.status).toBe(200);
    expect((await res.json()).showWind).toBe(false);
  });

  it("200s for an admin session with no token at all", async () => {
    mockGetScene.mockResolvedValue({ watchToken: "abc123" });
    mockCookieGet.mockReturnValue({ value: "tok" });
    mockIsAdmin.mockReturnValue(true);
    expect((await getReq("http://x/api/scenes/atlantic")).status).toBe(200);
  });

  it("resolves the main scene via getOrInitBroadcastState, not getScene", async () => {
    mockGetOrInit.mockResolvedValue({ watchToken: "abc123" });
    mockCookieGet.mockReturnValue({ value: "tok" });
    mockIsAdmin.mockReturnValue(true);
    await getReq("http://x/api/scenes/default");
    expect(mockGetOrInit).toHaveBeenCalled();
    expect(mockGetScene).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/scenes/:id", () => {
  it("404s when the scene doesn't exist", async () => {
    const res = await patchReq("atlantic", { showWind: false });
    expect(res.status).toBe(404);
    expect(mockUpsertByID).not.toHaveBeenCalled();
  });

  it("merges the patch onto the EXISTING state, not a blank default — the whole point of a delta", async () => {
    mockGetScene.mockResolvedValue({ showWind: false, units: { wind: "kt", temp: "F" } });
    const res = await patchReq("atlantic", { showSatImg: true });
    expect(res.status).toBe(200);
    const merged = await res.json();
    // The field the patch never mentioned survives from the existing doc...
    expect(merged.showWind).toBe(false);
    // ...and the patched field lands.
    expect(merged.showSatImg).toBe(true);
  });

  it("preserves the scene name (outside ControlState) across the merge", async () => {
    mockGetScene.mockResolvedValue({ name: "Atlantic Wind", showWind: true });
    await patchReq("atlantic-wind", { showWind: false });
    const [, savedDoc] = mockUpsertByID.mock.calls[0];
    expect(savedDoc.name).toBe("Atlantic Wind");
    expect(savedDoc.showWind).toBe(false);
  });

  it("treats an unparsable body as a no-op patch instead of erroring", async () => {
    mockGetScene.mockResolvedValue({ showWind: true });
    const res = await PATCH(
      new Request("http://x/api/scenes/atlantic", { method: "PATCH", body: "not json" }) as never,
      params("atlantic"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).showWind).toBe(true);
  });
});

describe("DELETE /api/scenes/:id", () => {
  it("400s deleting the main scene — never gets to the db", async () => {
    const res = await deleteReq("default");
    expect(res.status).toBe(400);
    expect(mockDeleteScene).not.toHaveBeenCalled();
    expect(mockDeleteDirectorConfig).not.toHaveBeenCalled();
  });

  it("404s a scene that doesn't exist — no director-config cleanup either", async () => {
    mockDeleteScene.mockResolvedValue(false);
    expect((await deleteReq("nope")).status).toBe(404);
    expect(mockDeleteDirectorConfig).not.toHaveBeenCalled();
  });

  it("200s, reports the deleted id and drops the scene's director config", async () => {
    mockDeleteScene.mockResolvedValue(true);
    const res = await deleteReq("atlantic-wind");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "atlantic-wind" });
    expect(mockDeleteDirectorConfig).toHaveBeenCalledWith("atlantic-wind");
  });

  it("drops a crossword channel's config and game with it", async () => {
    mockGetScene.mockResolvedValue({ id: "xw", surface: "crossword" });
    mockDeleteScene.mockResolvedValue(true);
    expect((await deleteReq("xw")).status).toBe(200);
    expect(mockDeleteCrossword).toHaveBeenCalledWith("xw");
  });

  it("leaves crossword data alone for a weather channel", async () => {
    mockGetScene.mockResolvedValue({ id: "atlantic-wind" });
    mockDeleteScene.mockResolvedValue(true);
    await deleteReq("atlantic-wind");
    expect(mockDeleteCrossword).not.toHaveBeenCalled();
  });

  it("409s a short format's scene — the format owns it", async () => {
    mockGetFormat.mockResolvedValue({ id: "shorts", name: "Round-up" });
    const res = await deleteReq("shorts");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/\/admin\/shorts/);
    expect(mockDeleteScene).not.toHaveBeenCalled();
  });
});

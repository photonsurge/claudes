/** @jest-environment node */

/**
 * GET /api/crossword/:scene/state — the gate (watch token or admin, as for
 * /api/scenes/:id), the 404 for anything that is not a crossword scene, the
 * idle projection before a game exists, and serverNow stamped at serve time.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockCookieGet = jest.fn();
jest.mock("next/headers", () => ({ cookies: async () => ({ get: mockCookieGet }) }));

const mockIsAdmin = jest.fn();
jest.mock("@photonsurge/shared/utill/session", () => ({
  SESSION_COOKIE: "wc_session",
  readSession: (t: string) => ({ token: t }),
  isAdmin: (...a: unknown[]) => mockIsAdmin(...a),
}));

const mockGetScene = jest.fn();
const mockGetPublic = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getScene: (...a: unknown[]) => mockGetScene(...a),
    crosswordGames: { getPublic: (...a: unknown[]) => mockGetPublic(...a) },
  }),
}));

import { GET } from "./route";

const get = (scene: string, qs = "") =>
  GET(new Request(`http://x/api/crossword/${scene}/state${qs}`) as never, { params: Promise.resolve({ scene }) });

beforeEach(() => {
  mockCookieGet.mockReset().mockReturnValue(undefined);
  mockIsAdmin.mockReset().mockReturnValue(false);
  mockGetScene.mockReset().mockResolvedValue(null);
  mockGetPublic.mockReset().mockResolvedValue(null);
});

describe("GET /api/crossword/:scene/state", () => {
  it("404s for a missing scene, a globe scene and the main scene", async () => {
    expect((await get("nope", "?token=t")).status).toBe(404);
    mockGetScene.mockResolvedValue({ watchToken: "t" });
    expect((await get("atlantic", "?token=t")).status).toBe(404);
    mockGetScene.mockResolvedValue({ watchToken: "t", surface: "globe" });
    expect((await get("atlantic", "?token=t")).status).toBe(404);
    expect((await get("default", "?token=t")).status).toBe(404);
    expect(mockGetPublic).not.toHaveBeenCalled();
  });

  it("401s with no session and a missing or wrong token", async () => {
    mockGetScene.mockResolvedValue({ watchToken: "abc", surface: "crossword" });
    expect((await get("xw")).status).toBe(401);
    expect((await get("xw", "?token=wrong")).status).toBe(401);
    expect(mockGetPublic).not.toHaveBeenCalled();
  });

  it("401s when the scene has no token at all, even if the caller sends an empty one", async () => {
    mockGetScene.mockResolvedValue({ surface: "crossword" });
    expect((await get("xw", "?token=")).status).toBe(401);
  });

  it("serves the stored projection for the matching token, with serverNow stamped now", async () => {
    mockGetScene.mockResolvedValue({ watchToken: "abc", surface: "crossword" });
    mockGetPublic.mockResolvedValue({ sceneId: "xw", seq: 7, serverNow: 1, phase: "playing", rows: ["AB"] });
    const before = Date.now();
    const res = await get("xw", "?token=abc");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seq).toBe(7);
    expect(body.rows).toEqual(["AB"]);
    expect(body.serverNow).toBeGreaterThanOrEqual(before);
    expect(mockGetPublic).toHaveBeenCalledWith("xw");
  });

  it("lets an admin session in without a token", async () => {
    mockGetScene.mockResolvedValue({ watchToken: "abc", surface: "crossword" });
    mockCookieGet.mockReturnValue({ value: "tok" });
    mockIsAdmin.mockReturnValue(true);
    expect((await get("xw")).status).toBe(200);
  });

  it("serves the empty idle projection before the game exists", async () => {
    mockGetScene.mockResolvedValue({ watchToken: "abc", surface: "crossword" });
    const body = await (await get("xw", "?token=abc")).json();
    expect(body).toMatchObject({ sceneId: "xw", phase: "idle", seq: 0, rows: [], entries: [] });
  });
});

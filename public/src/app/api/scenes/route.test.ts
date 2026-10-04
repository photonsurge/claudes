/** @jest-environment node */

/**
 * GET/POST /api/scenes — the scene catalog. Untested despite being the API
 * `useScenePatcher`/`listScenes`/`createScene` (public/src/lib/scenes.ts) and
 * proxy.ts's admin gate all depend on. The one thing actually worth pinning:
 * `watchToken` must never leak to an anonymous caller (GET is deliberately
 * ungated at the proxy layer — /watch/:id calls it to resolve a display name).
 */
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockCookieGet = jest.fn();
jest.mock("next/headers", () => ({ cookies: async () => ({ get: mockCookieGet }) }));

const mockIsAdmin = jest.fn();
jest.mock("@photonsurge/shared/utill/session", () => ({
  SESSION_COOKIE: "wc_session",
  readSession: (t: string) => ({ token: t }),
  isAdmin: (...a: unknown[]) => mockIsAdmin(...a),
}));

const mockGetOrInit = jest.fn();
const mockListScenes = jest.fn();
const mockGetScene = jest.fn();
const mockCreateScene = jest.fn();
const mockGetDirectorConfig = jest.fn();
const mockSaveDirectorConfig = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getOrInitBroadcastState: (...a: unknown[]) => mockGetOrInit(...a),
    listScenes: (...a: unknown[]) => mockListScenes(...a),
    getScene: (...a: unknown[]) => mockGetScene(...a),
    createScene: (...a: unknown[]) => mockCreateScene(...a),
    getOrInitDirectorConfig: (...a: unknown[]) => mockGetDirectorConfig(...a),
    saveDirectorConfig: (...a: unknown[]) => mockSaveDirectorConfig(...a),
  }),
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/scenes", { method: "POST", body: JSON.stringify(body) }) as never);

beforeEach(() => {
  mockCookieGet.mockReset().mockReturnValue(undefined);
  mockIsAdmin.mockReset().mockReturnValue(false);
  mockGetOrInit.mockReset().mockResolvedValue({ id: "default", name: "Main" });
  mockListScenes.mockReset().mockResolvedValue([{ id: "default", name: "Main", watchToken: "secret-token" }]);
  mockGetScene.mockReset().mockResolvedValue(null);
  mockCreateScene.mockReset();
  mockGetDirectorConfig
    .mockReset()
    .mockResolvedValue({ mode: "auto", skipNonce: 7, countries: ["uk"], kinds: { storm: true } });
  mockSaveDirectorConfig.mockReset();
});

describe("GET /api/scenes", () => {
  it("seeds the main scene before listing", async () => {
    await GET();
    expect(mockGetOrInit).toHaveBeenCalled();
  });

  it("strips watchToken for an anonymous/non-admin caller", async () => {
    const body = await (await GET()).json();
    expect(body.scenes).toEqual([{ id: "default", name: "Main" }]);
  });

  it("includes watchToken for an admin session", async () => {
    mockCookieGet.mockReturnValue({ value: "tok" });
    mockIsAdmin.mockReturnValue(true);
    const body = await (await GET()).json();
    expect(body.scenes[0].watchToken).toBe("secret-token");
  });
});

describe("POST /api/scenes", () => {
  it("400s an empty/whitespace name", async () => {
    expect((await post({ name: "" })).status).toBe(400);
    expect((await post({ name: "   " })).status).toBe(400);
  });

  it("400s a name that slugs to the reserved main scene id", async () => {
    const res = await post({ name: "Default" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reserved/);
  });

  it("409s when the slug already exists", async () => {
    mockGetScene.mockResolvedValue({ id: "atlantic-wind", name: "Atlantic Wind" });
    const res = await post({ name: "Atlantic Wind" });
    expect(res.status).toBe(409);
  });

  it("seeds a new scene from the main state by default", async () => {
    mockCreateScene.mockResolvedValue({ id: "atlantic-wind", name: "Atlantic Wind" });
    const res = await post({ name: "Atlantic Wind" });
    expect(res.status).toBe(201);
    expect(mockGetOrInit).toHaveBeenCalled();
    expect(mockCreateScene).toHaveBeenCalledWith("atlantic-wind", "Atlantic Wind", expect.any(Object));
    expect((await res.json()).id).toBe("atlantic-wind");
  });

  it("seeds from copyFrom when given, not the main scene", async () => {
    mockGetScene.mockImplementation(async (id: string) =>
      id === "pacific-storm" ? { id: "pacific-storm", showWind: false } : null,
    );
    mockCreateScene.mockResolvedValue({ id: "atlantic-wind" });
    await post({ name: "Atlantic Wind", copyFrom: "pacific-storm" });
    expect(mockGetScene).toHaveBeenCalledWith("pacific-storm");
    // copyFrom set → the main scene is never fetched as the seed source.
    expect(mockGetOrInit).not.toHaveBeenCalled();
  });

  it("clones the source's director config with mode off and skipNonce reset", async () => {
    mockGetScene.mockImplementation(async (id: string) =>
      id === "pacific-storm" ? { id: "pacific-storm" } : null,
    );
    mockCreateScene.mockResolvedValue({ id: "atlantic-wind" });
    await post({ name: "Atlantic Wind", copyFrom: "pacific-storm" });

    expect(mockGetDirectorConfig).toHaveBeenCalledWith("pacific-storm");
    expect(mockSaveDirectorConfig).toHaveBeenCalledWith("atlantic-wind", {
      // Content survives the clone…
      countries: ["uk"],
      kinds: { storm: true },
      // …runtime fields don't: a fresh channel must never start auto-piloting.
      mode: "off",
      skipNonce: 0,
    });
  });

  it("drops the source's script-play trigger from the clone", async () => {
    mockGetDirectorConfig.mockResolvedValueOnce({
      mode: "script",
      skipNonce: 3,
      countries: ["uk"],
      script: { scriptId: "s1", fromClip: 0, playNonce: 4, record: true },
    });
    mockCreateScene.mockResolvedValue({ id: "atlantic-wind" });
    await post({ name: "Atlantic Wind" });
    const saved = mockSaveDirectorConfig.mock.calls[0][1];
    expect(saved).not.toHaveProperty("script");
    expect(saved).toEqual({ countries: ["uk"], mode: "off", skipNonce: 0 });
  });

  it("copies the main scene's director config by default", async () => {
    mockCreateScene.mockResolvedValue({ id: "atlantic-wind" });
    await post({ name: "Atlantic Wind" });
    expect(mockGetDirectorConfig).toHaveBeenCalledWith("default");
    expect(mockSaveDirectorConfig).toHaveBeenCalledWith(
      "atlantic-wind",
      expect.objectContaining({ mode: "off", skipNonce: 0 }),
    );
  });
});

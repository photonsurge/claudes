/** @jest-environment node */

/**
 * GET /api/scenes against docs/crossword-mode-plan.md §8.1 and §10 and the
 * batch's intent: the scene list carries each channel's YouTube account
 * (`youtubeAccountId`) for the Channels list and go-live, to admins only.
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
const mockListScenes = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({ getOrInitBroadcastState: async () => ({}), listScenes: (...a: unknown[]) => mockListScenes(...a) }),
}));

import { GET } from "./route";

const SCENES = [
  { id: "default", name: "Main", watchToken: "t0", youtubeAccountId: "UCweather" },
  { id: "words", name: "Words", surface: "crossword", watchToken: "t1", youtubeAccountId: "UCwords" },
  { id: "bare", name: "Bare", surface: "crossword" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockListScenes.mockResolvedValue(SCENES);
});

it("an admin gets each channel's YouTube account", async () => {
  mockCookieGet.mockReturnValue({ value: "s" });
  mockIsAdmin.mockReturnValue(true);
  const { scenes } = await (await (GET as () => Promise<Response>)()).json();
  expect(scenes.map((s: { id: string; youtubeAccountId?: string }) => [s.id, s.youtubeAccountId])).toEqual([
    ["default", "UCweather"],
    ["words", "UCwords"],
    ["bare", undefined],
  ]);
});

it("an anonymous caller gets no YouTube account (and no token)", async () => {
  mockCookieGet.mockReturnValue(undefined);
  mockIsAdmin.mockReturnValue(false);
  const res = await (GET as () => Promise<Response>)();
  const text = await res.text();
  expect(text).not.toMatch(/UCweather|UCwords|youtubeAccountId/);
  expect(JSON.parse(text).scenes.map((s: { id: string }) => s.id)).toEqual(["default", "words", "bare"]);
});

it("a signed-in non-admin gets no YouTube account either", async () => {
  mockCookieGet.mockReturnValue({ value: "s" });
  mockIsAdmin.mockReturnValue(false);
  const text = await (await (GET as () => Promise<Response>)()).text();
  expect(text).not.toMatch(/youtubeAccountId/);
});

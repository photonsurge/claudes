/** @jest-environment node */

/**
 * GET/PATCH /api/crossword/:scene/config — admin only (proxy.ts doesn't match
 * /api/crossword), 404 for an unknown scene, and a PATCH goes through the db's
 * merge so bad values are clamped there.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockGetScene = jest.fn();
const mockGetConfig = jest.fn();
const mockSaveConfig = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getScene: (...a: unknown[]) => mockGetScene(...a),
    getOrInitCrosswordConfig: (...a: unknown[]) => mockGetConfig(...a),
    saveCrosswordConfig: (...a: unknown[]) => mockSaveConfig(...a),
  }),
}));

import { DEFAULT_CROSSWORD_CONFIG } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../../lib/require-admin";
import { GET, PATCH } from "./route";

const params = { params: Promise.resolve({ scene: "xw" }) };
const get = () => GET(new Request("http://x/api/crossword/xw/config"), params);
const patch = (body: unknown) =>
  PATCH(new Request("http://x/api/crossword/xw/config", { method: "PATCH", body: JSON.stringify(body) }), params);

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockGetScene.mockResolvedValue({ id: "xw", surface: "crossword" });
  mockGetConfig.mockResolvedValue(DEFAULT_CROSSWORD_CONFIG);
  mockSaveConfig.mockImplementation(async (_id: string, p: object) => ({ ...DEFAULT_CROSSWORD_CONFIG, ...p }));
});

it("is admin only, both ways", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  expect((await patch({ clueS: 30 })).status).toBe(401);
  expect(mockGetConfig).not.toHaveBeenCalled();
  expect(mockSaveConfig).not.toHaveBeenCalled();
});

it("404s an unknown scene", async () => {
  mockGetScene.mockResolvedValue(null);
  expect((await get()).status).toBe(404);
  expect((await patch({ clueS: 30 })).status).toBe(404);
  expect(mockSaveConfig).not.toHaveBeenCalled();
});

it("serves the merged config", async () => {
  const res = await get();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(DEFAULT_CROSSWORD_CONFIG);
  expect(mockGetConfig).toHaveBeenCalledWith("xw");
});

it("saves a patch through the db merge and returns the result", async () => {
  const res = await patch({ clueS: 30, enabled: true });
  expect(res.status).toBe(200);
  expect(mockSaveConfig).toHaveBeenCalledWith("xw", { clueS: 30, enabled: true });
  expect((await res.json()).clueS).toBe(30);
});

it("400s a body that isn't an object", async () => {
  expect((await patch([1, 2])).status).toBe(400);
  expect(mockSaveConfig).not.toHaveBeenCalled();
});

it("passes the theme to the db merge, which sanitizes it", async () => {
  const theme = { brand: { title: "Word Up", logoUrl: "/l.png" } };
  const res = await patch({ theme });
  expect(res.status).toBe(200);
  expect(mockSaveConfig).toHaveBeenCalledWith("xw", { theme });
  expect((await res.json()).theme).toEqual(theme);
});

it("404s a weather channel and writes nothing", async () => {
  mockGetScene.mockResolvedValue({ id: "wind", surface: "globe" });
  expect((await get()).status).toBe(404);
  expect((await patch({ clueS: 30 })).status).toBe(404);
  expect(mockGetConfig).not.toHaveBeenCalled();
  expect(mockSaveConfig).not.toHaveBeenCalled();
});

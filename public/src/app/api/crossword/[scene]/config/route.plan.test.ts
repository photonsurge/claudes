/** @jest-environment node */

/**
 * Plan §8.4 — `GET`/`PATCH :scene/config`, gate: admin. The crossword settings
 * page saves Look and Game here, so the route must accept the theme (§5.1) as
 * well as the game fields, through the config merge that clamps and sanitizes.
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

import {
  DEFAULT_CROSSWORD_CONFIG,
  mergeCrosswordConfig,
  type CrosswordConfig,
} from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../../lib/require-admin";
import { GET, PATCH } from "./route";

const ctx = { params: Promise.resolve({ scene: "puzzle-hour" }) };
const get = () => GET(new Request("http://x/api/crossword/puzzle-hour/config"), ctx);
const patch = (body: unknown) =>
  PATCH(
    new Request("http://x/api/crossword/puzzle-hour/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx,
  );

/** A stored config, saved through the real merge (as the db facade does). */
let stored: CrosswordConfig;

beforeEach(() => {
  jest.clearAllMocks();
  stored = DEFAULT_CROSSWORD_CONFIG;
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op@example.com" });
  mockGetScene.mockResolvedValue({ id: "puzzle-hour", surface: "crossword" });
  mockGetConfig.mockImplementation(async () => stored);
  mockSaveConfig.mockImplementation(async (_id: string, p: Record<string, unknown>) => {
    stored = mergeCrosswordConfig(stored, p);
    return stored;
  });
});

describe("gate", () => {
  it("refuses GET and PATCH without an admin session, touching nothing", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue(null);
    const g = await get();
    const p = await patch({ clueS: 30 });
    expect(g.status).toBe(401);
    expect(p.status).toBe(401);
    expect(mockGetScene).not.toHaveBeenCalled();
    expect(mockGetConfig).not.toHaveBeenCalled();
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it("is never cached", async () => {
    expect((await get()).headers.get("Cache-Control")).toMatch(/no-store/);
    (requireAdmin as jest.Mock).mockResolvedValue(null);
    expect((await get()).headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("404s a scene that does not exist", async () => {
    mockGetScene.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await patch({ clueS: 30 })).status).toBe(404);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});

describe("the settings page's Save", () => {
  it("accepts the theme with the game fields, and returns what was stored", async () => {
    const theme = {
      ...DEFAULT_CROSSWORD_CONFIG.theme,
      brand: { title: "Cryptic Nights", logoUrl: "/images/cn.png" },
    };
    const res = await patch({ theme, clueS: 75, minZipf: 4, familyFriendlyOnly: false, playOffAir: true });
    expect(res.status).toBe(200);
    expect(mockSaveConfig).toHaveBeenCalledWith("puzzle-hour", expect.objectContaining({ theme }));
    const body = await res.json();
    expect(body.theme.brand).toEqual({ title: "Cryptic Nights", logoUrl: "/images/cn.png" });
    expect(body).toMatchObject({ clueS: 75, minZipf: 4, familyFriendlyOnly: false, playOffAir: true });

    // GET then serves it back.
    const again = await (await get()).json();
    expect(again.theme.brand.title).toBe("Cryptic Nights");
  });

  it("returns the merge's sanitized theme, not what was sent", async () => {
    const res = await patch({
      theme: { brand: { title: "Ok", logoUrl: "javascript:alert(1)" }, colors: { background: "red;}" } },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.theme.brand.title).toBe("Ok");
    expect(body.theme.brand.logoUrl).toBe("");
    expect(body.theme.colors.background).toBe(DEFAULT_CROSSWORD_CONFIG.theme.colors.background);
  });

  it("refuses a body that is not a config object", async () => {
    expect((await patch([{ theme: {} }])).status).toBe(400);
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });
});

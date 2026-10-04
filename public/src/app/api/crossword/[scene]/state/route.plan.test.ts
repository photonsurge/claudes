/** @jest-environment node */

/**
 * GET /api/crossword/:scene/state, from the plan (§3, §4.3, §5.1, §12 public):
 * tokened like the weather page (the channel token or an admin session), it
 * serves the public projection and, of the channel's config, the theme only:
 * never the blocklist or any other config field, and never an answer.
 */
import {
  DEFAULT_CROSSWORD_THEME,
  type CrosswordPublicState,
  type CrosswordTheme,
} from "@photonsurge/shared/crossword";
import { HIDDEN_ANSWERS, PUZZLE, game, pub } from "../../../../../components/crossword/plan.fixture";

jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));

const mockCookieGet = jest.fn();
jest.mock("next/headers", () => ({ cookies: async () => ({ get: mockCookieGet }) }));

const mockIsAdmin = jest.fn();
jest.mock("@photonsurge/shared/utill/session", () => ({
  SESSION_COOKIE: "wc_session",
  readSession: (t: string) => ({ token: t }),
  isAdmin: (...a: unknown[]) => mockIsAdmin(...a),
}));

// The db exposes the stored game and puzzle (answers and all) too, so a route
// that reached past the projection would be caught by the answer checks.
const mockGetScene = jest.fn();
const mockGetPublic = jest.fn();
const mockGetConfig = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getScene: (...a: unknown[]) => mockGetScene(...a),
    getOrInitCrosswordConfig: (...a: unknown[]) => mockGetConfig(...a),
    getCrosswordConfig: (...a: unknown[]) => mockGetConfig(...a),
    crosswordGames: {
      getPublic: (...a: unknown[]) => mockGetPublic(...a),
      get: async () => ({ ...game(), pub: pub() }),
      getGame: async () => ({ ...game(), pub: pub() }),
    },
    crosswordPuzzles: { get: async () => PUZZLE, getById: async () => PUZZLE },
  }),
}));

import { GET } from "./route";

const get = (scene: string, qs = "") =>
  GET(new Request(`http://x/api/crossword/${scene}/state${qs}`) as never, { params: Promise.resolve({ scene }) });

const THEME: CrosswordTheme = {
  preset: DEFAULT_CROSSWORD_THEME.preset,
  brand: { title: "Grid Night", logoUrl: "https://example.com/logo.png" },
  colors: {
    background: "#101820",
    panel: "#ffffff",
    cell: "#f8fafc",
    cellSolved: "#eef2ff",
    block: "#0f172a",
    ink: "#0f172a",
    inkMuted: "#475569",
    accent: "#f97316",
  },
  font: { display: "Inter, sans-serif", text: "Inter, sans-serif" },
};

/** A config with every kind of field the page must not see. */
const CONFIG = {
  sceneId: "xw",
  enabled: true,
  playOffAir: true,
  introS: 12,
  clueS: 60,
  finaleS: 30,
  streamDelayS: 10,
  blocklist: ["zorgblat", "frumious"],
  familyFriendlyOnly: true,
  theme: THEME,
};

const PUBLIC_KEYS = Object.keys(pub());

beforeEach(() => {
  mockCookieGet.mockReset().mockReturnValue(undefined);
  mockIsAdmin.mockReset().mockReturnValue(false);
  mockGetScene.mockReset().mockResolvedValue({ id: "xw", name: "XW", surface: "crossword", watchToken: "good" });
  mockGetPublic.mockReset().mockResolvedValue(pub());
  mockGetConfig.mockReset().mockResolvedValue(CONFIG);
});

describe("the gate", () => {
  it("refuses a request with no token", async () => {
    const res = await get("xw");
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("Particles");
  });

  it("refuses a wrong token", async () => {
    const res = await get("xw", "?token=bad");
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain("Particles");
  });

  it("refuses a token that belongs to another channel's scene", async () => {
    mockGetScene.mockImplementation(async (id: string) =>
      id === "xw" ? { id: "xw", surface: "crossword", watchToken: "good" } : { id: "other", surface: "crossword", watchToken: "theirs" },
    );
    expect((await get("xw", "?token=theirs")).status).toBe(401);
  });

  it("serves the channel's own token", async () => {
    const res = await get("xw", "?token=good");
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Particles");
  });

  it("lets an admin session through without a token", async () => {
    mockCookieGet.mockReturnValue({ value: "session-cookie" });
    mockIsAdmin.mockReturnValue(true);
    const res = await get("xw");
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Particles");
  });

  it("does not let a non-admin session through without a token", async () => {
    mockCookieGet.mockReturnValue({ value: "session-cookie" });
    mockIsAdmin.mockReturnValue(false);
    expect((await get("xw")).status).toBe(401);
  });

  it("is not cached", async () => {
    const res = await get("xw", "?token=good");
    expect(res.headers.get("Cache-Control") ?? "").toMatch(/no-store/);
  });
});

describe("what it serves", () => {
  it("serves the projection plus the theme and nothing else", async () => {
    const body = (await (await get("xw", "?token=good")).json()) as Record<string, unknown>;
    const extra = Object.keys(body).filter((k) => !PUBLIC_KEYS.includes(k));
    expect(extra).toEqual(["theme"]);
  });

  it("serves the configured theme", async () => {
    const body = await (await get("xw", "?token=good")).json();
    expect(body.theme).toEqual(THEME);
  });

  it("never serves the blocklist or any other config field", async () => {
    const body = await (await get("xw", "?token=good")).json();
    const text = JSON.stringify(body);
    expect(text).not.toContain("zorgblat");
    expect(text).not.toContain("frumious");
    for (const k of ["blocklist", "familyFriendlyOnly", "playOffAir", "enabled", "clueS", "introS", "finaleS", "streamDelayS"]) {
      expect(body).not.toHaveProperty(k);
      expect(body.theme).not.toHaveProperty(k);
    }
  });

  it("never serves an unsolved answer", async () => {
    const text = JSON.stringify(await (await get("xw", "?token=good")).json());
    for (const a of HIDDEN_ANSWERS) expect(text).not.toContain(a);
    expect(text).not.toContain('"answer"');
  });

  it("never serves an answer to an admin either", async () => {
    mockCookieGet.mockReturnValue({ value: "session-cookie" });
    mockIsAdmin.mockReturnValue(true);
    const text = JSON.stringify(await (await get("xw")).json());
    for (const a of HIDDEN_ANSWERS) expect(text).not.toContain(a);
    expect(text).not.toContain('"answer"');
  });

  it("stamps serverNow at serve time", async () => {
    mockGetPublic.mockResolvedValue({ ...pub(), serverNow: 5 } as CrosswordPublicState);
    const before = Date.now();
    const body = await (await get("xw", "?token=good")).json();
    expect(body.serverNow).toBeGreaterThanOrEqual(before);
  });

  it("serves an idle projection, not an error, before the first game", async () => {
    mockGetPublic.mockResolvedValue(null);
    const res = await get("xw", "?token=good");
    expect(res.status).toBe(200);
    expect((await res.json()).phase).toBe("idle");
  });
});

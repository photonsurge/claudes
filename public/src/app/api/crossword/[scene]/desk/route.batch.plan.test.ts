/** @jest-environment node */

/**
 * GET /api/crossword/:scene/desk against docs/crossword-mode-plan.md §7.4,
 * §7.5 and §8.3, written from the plan and the batch's intent: admins get one
 * structured stock reason (fresh / replay / noReady / noFamilyFriendly with
 * the unplayed count), the same one the runner uses, and the approved-pool
 * counts. A channel whose stock is all inside the no-repeat window replays;
 * puzzles built from unapproved words never count unless the dev switch is on.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  getScene: jest.fn(),
  getOrInitCrosswordConfig: jest.fn(),
  crosswordPuzzles: { list: jest.fn() },
  crosswordGames: { get: jest.fn() },
  crosswordBank: { poolCounts: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { DEFAULT_CROSSWORD_CONFIG, crosswordStockReason, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../../lib/require-admin";
import { GET } from "./route";

const SCENE = "words";
const get = async (scene = SCENE) => {
  const res = await GET(new Request(`http://x/api/crossword/${scene}/desk`), { params: Promise.resolve({ scene }) });
  return { status: res.status, body: await res.json(), headers: res.headers };
};
const mk = (id: string, o: Partial<CrosswordPuzzle> = {}): CrosswordPuzzle => ({
  id,
  title: id,
  width: 3,
  height: 1,
  entries: [{ id: "1A", num: 1, dir: "across", row: 0, col: 0, answer: "CAT", clue: "Feline pet", wordId: "w", clueId: "c" }],
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 1,
  plays: [],
  ...o,
});
const playedHere = (at: number) => ({ sceneId: SCENE, startedAt: at, endedAt: at + 1 });
let stock: CrosswordPuzzle[];
const POOL = { words: 320, ffWords: 200, puzzlesWithoutRepeat: 22, ffPuzzlesWithoutRepeat: 14, targetWords: 280 };
let savedEnv: string | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  savedEnv = process.env.CROSSWORD_ALLOW_UNAPPROVED;
  delete process.env.CROSSWORD_ALLOW_UNAPPROVED;
  stock = [];
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op@example.com", sub: "op" });
  mockDb.getScene.mockResolvedValue({ id: SCENE, name: "Words", surface: "crossword" });
  mockDb.getOrInitCrosswordConfig.mockResolvedValue({ ...DEFAULT_CROSSWORD_CONFIG, familyFriendlyOnly: false, noRepeatPuzzles: 30 });
  // Honour the status filter, as the repo does.
  mockDb.crosswordPuzzles.list.mockImplementation(async (o: { status?: string } = {}) => stock.filter((p) => !o.status || p.status === o.status));
  mockDb.crosswordGames.get.mockResolvedValue(null);
  mockDb.crosswordBank.poolCounts.mockResolvedValue(POOL);
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.CROSSWORD_ALLOW_UNAPPROVED;
  else process.env.CROSSWORD_ALLOW_UNAPPROVED = savedEnv;
});

describe("gate", () => {
  it("is admin only", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue(null);
    const r = await get();
    expect(r.status).toBe(401);
    expect(r.body).not.toHaveProperty("reason");
    expect(mockDb.crosswordPuzzles.list).not.toHaveBeenCalled();
  });

  it("is 404 for a scene that is not a crossword channel", async () => {
    mockDb.getScene.mockResolvedValue({ id: SCENE, name: "Weather" });
    expect((await get()).status).toBe(404);
    mockDb.getScene.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it("is never cached", async () => {
    expect((await get()).headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("the reason and the pool", () => {
  it("serves the structured reason with the pool counts", async () => {
    stock = [mk("a"), mk("b")];
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ reason: { kind: "fresh", unplayed: 2 }, pool: POOL });
  });

  it("all stock inside the no-repeat window while idle: replay, not an idle reason", async () => {
    stock = [mk("a", { plays: [playedHere(10)] }), mk("b", { plays: [playedHere(20)] })];
    expect((await get()).body.reason).toEqual({ kind: "replay", unplayed: 0 });
  });

  it("no ready puzzle: noReady", async () => {
    stock = [mk("r", { status: "rejected" })];
    expect((await get()).body.reason).toEqual({ kind: "noReady", unplayed: 0 });
  });

  it("a family-friendly channel with only untagged ready stock: noFamilyFriendly", async () => {
    mockDb.getOrInitCrosswordConfig.mockResolvedValue({ ...DEFAULT_CROSSWORD_CONFIG, familyFriendlyOnly: true, noRepeatPuzzles: 30 });
    stock = [mk("a", { familyFriendly: false })];
    expect((await get()).body.reason.kind).toBe("noFamilyFriendly");
  });

  it("the puzzle on air for a second time here is a replay; its first time is fresh", async () => {
    stock = [mk("on", { plays: [playedHere(10), { sceneId: SCENE, startedAt: 100 }] }), mk("next")];
    mockDb.crosswordGames.get.mockResolvedValue({ sceneId: SCENE, puzzleId: "on", phase: "playing", seq: 5 });
    expect((await get()).body.reason).toEqual({ kind: "replay", unplayed: 1 });
    stock = [mk("on", { plays: [{ sceneId: SCENE, startedAt: 100 }] }), mk("next")];
    expect((await get()).body.reason).toEqual({ kind: "fresh", unplayed: 1 });
  });

  it("is the same reason the runner computes from the same stock and config", async () => {
    stock = [mk("a", { plays: [playedHere(10)] }), mk("b", { familyFriendly: false }), mk("c", { createdAt: 5 })];
    mockDb.getOrInitCrosswordConfig.mockResolvedValue({ ...DEFAULT_CROSSWORD_CONFIG, familyFriendlyOnly: true, noRepeatPuzzles: 3 });
    const want = crosswordStockReason(stock, SCENE, "", { familyFriendlyOnly: true, noRepeatPuzzles: 3 });
    expect((await get()).body.reason).toEqual(want);
  });

  it("unapproved puzzles do not count unless CROSSWORD_ALLOW_UNAPPROVED=true", async () => {
    stock = [mk("u", { unapproved: true })];
    expect((await get()).body.reason.kind).toBe("noReady");
    process.env.CROSSWORD_ALLOW_UNAPPROVED = "true";
    expect((await get()).body.reason).toEqual({ kind: "fresh", unplayed: 1 });
  });

  it("the pool is null, not an error, when the bank cannot be read", async () => {
    stock = [mk("a")];
    mockDb.crosswordBank.poolCounts.mockRejectedValue(new Error("bank down"));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ reason: { kind: "fresh", unplayed: 1 }, pool: null });
  });
});

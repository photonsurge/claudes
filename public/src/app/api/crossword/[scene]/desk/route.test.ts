/** @jest-environment node */

/**
 * GET /api/crossword/:scene/desk — the Desk's structured stock reason (§7.5)
 * and the approved pool. Carries the intent of the Desk's old client-side
 * derivation (deskReason.test.ts): no ready puzzles, none family friendly on a
 * family-friendly channel, a replay when the puzzle on air aired here before,
 * plays on other channels not counting, and the config's defaults.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockGetScene = jest.fn();
const mockGetConfig = jest.fn();
const mockList = jest.fn();
const mockGame = jest.fn();
const mockPool = jest.fn();
const mockGetPuzzle = jest.fn();
jest.mock("@photonsurge/shared/db/index", () => ({
  getAppDb: async () => ({
    getScene: (...a: unknown[]) => mockGetScene(...a),
    getOrInitCrosswordConfig: (...a: unknown[]) => mockGetConfig(...a),
    crosswordPuzzles: { list: (...a: unknown[]) => mockList(...a), get: (...a: unknown[]) => mockGetPuzzle(...a) },
    crosswordGames: { get: (...a: unknown[]) => mockGame(...a) },
    crosswordBank: { poolCounts: (...a: unknown[]) => mockPool(...a) },
  }),
}));

import { DEFAULT_CROSSWORD_CONFIG, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { poolCounts } from "@photonsurge/shared/crossword-bank";
import { requireAdmin } from "../../../../../lib/require-admin";
import { GET } from "./route";

const params = { params: Promise.resolve({ scene: "xw" }) };
const get = async () => {
  const res = await GET(new Request("http://x/api/crossword/xw/desk"), params);
  return { status: res.status, body: await res.json() };
};
const puzzle = (id: string, o: Partial<CrosswordPuzzle> = {}): CrosswordPuzzle => ({
  id,
  title: `Puzzle ${id}`,
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
const play = (at: number, sceneId = "xw") => ({ sceneId, startedAt: at });
let ready: CrosswordPuzzle[];

beforeEach(() => {
  jest.clearAllMocks();
  ready = [];
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockGetScene.mockResolvedValue({ id: "xw", surface: "crossword" });
  mockGetConfig.mockResolvedValue({ ...DEFAULT_CROSSWORD_CONFIG, noRepeatPuzzles: 2 });
  mockList.mockImplementation(async () => ready);
  mockGame.mockResolvedValue({ phase: "idle", puzzleId: "" });
  mockPool.mockResolvedValue(poolCounts(140, 70));
});

it("is admin only, and only for a crossword channel", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockGetScene.mockResolvedValue({ id: "xw" });
  expect((await get()).status).toBe(404);
  mockGetScene.mockResolvedValue(null);
  expect((await get()).status).toBe(404);
  expect(mockList).not.toHaveBeenCalled();
});

it("reads only the ready stock, and serves the pool beside the reason", async () => {
  const { status, body } = await get();
  expect(status).toBe(200);
  expect(mockList).toHaveBeenCalledWith({ status: "ready" });
  expect(body).toEqual({ reason: { kind: "noReady", unplayed: 0 }, pool: poolCounts(140, 70) });
});

it("no family-friendly ready puzzle, only when the channel asks for them", async () => {
  ready = [puzzle("a", { familyFriendly: false })];
  expect((await get()).body.reason).toEqual({ kind: "noFamilyFriendly", unplayed: 0 });
  mockGetConfig.mockResolvedValue({ ...DEFAULT_CROSSWORD_CONFIG, familyFriendlyOnly: false });
  expect((await get()).body.reason).toEqual({ kind: "fresh", unplayed: 1 });
});

it("every eligible puzzle inside the no-repeat window: a replay, not idle (§7.5)", async () => {
  ready = [puzzle("a", { plays: [play(1)] }), puzzle("b", { plays: [play(2)] })];
  expect((await get()).body.reason).toEqual({ kind: "replay", unplayed: 0 });
});

it("fresh while a puzzle is unplayed; plays on other channels do not count", async () => {
  ready = [puzzle("a", { plays: [play(1)] }), puzzle("b")];
  expect((await get()).body.reason).toEqual({ kind: "fresh", unplayed: 1 });
  ready = [puzzle("a", { plays: [play(1, "other")] })];
  expect((await get()).body.reason.kind).toBe("fresh");
});

it("replaying when the puzzle on air has an earlier play here, not on its first play", async () => {
  mockGame.mockResolvedValue({ phase: "playing", puzzleId: "a" });
  ready = [puzzle("a", { plays: [play(1), play(2)] })];
  expect((await get()).body.reason.kind).toBe("replay");
  ready = [puzzle("a", { plays: [play(2)] })];
  expect((await get()).body.reason.kind).toBe("fresh");
  ready = [puzzle("a", { plays: [play(1, "other"), play(2)] })];
  expect((await get()).body.reason.kind).toBe("fresh");
});

it("a channel with no game yet, and a pool that cannot be read", async () => {
  mockGame.mockResolvedValue(null);
  mockPool.mockRejectedValue(new Error("no bank"));
  ready = [puzzle("a")];
  expect((await get()).body).toEqual({ reason: { kind: "fresh", unplayed: 1 }, pool: null });
});

it("a puzzle withdrawn on air is read by id and reported as withdrawn", async () => {
  mockGame.mockResolvedValue({ phase: "playing", puzzleId: "a" });
  const gone = puzzle("a", { status: "rejected", plays: [play(1)] });
  ready = [puzzle("b")];
  mockGetPuzzle.mockResolvedValue(gone);
  expect((await get()).body.reason).toEqual({ kind: "withdrawn", unplayed: 1 });
  expect(mockGetPuzzle).toHaveBeenCalledWith("a");
  // Untagged on a family-friendly channel: still ready, but withdrawn here.
  ready = [puzzle("a", { familyFriendly: false, plays: [play(1)] })];
  mockGetPuzzle.mockClear();
  expect((await get()).body.reason.kind).toBe("withdrawn");
  expect(mockGetPuzzle).not.toHaveBeenCalled();
});

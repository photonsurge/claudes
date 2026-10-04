/** @jest-environment node */

/**
 * GET/PATCH /api/crossword/puzzles/:id — admin only; approve and reject set
 * the status; a clue edit is validated (with the channels' blocklists); a drop
 * is refused while on air, when it splits the grid, or below minWords.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  crosswordPuzzles: { get: jest.fn(), setStatus: jest.fn(), upsert: jest.fn() },
  crosswordScenes: jest.fn(),
  getOrInitCrosswordConfig: jest.fn(),
  crosswordGames: { get: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { DEFAULT_CROSSWORD_CONFIG, numberEntries, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../../lib/require-admin";
import { GET, PATCH } from "./route";

const puzzle = (): CrosswordPuzzle => ({
  id: "p1",
  title: "Chain",
  width: 5,
  height: 3,
  status: "rejected",
  familyFriendly: false,
  source: "seed",
  createdAt: 1,
  plays: [],
  entries: numberEntries([
    { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
    { answer: "TOE", clue: "Digit on a foot", row: 0, col: 2, dir: "down" },
    { answer: "EGG", clue: "Breakfast oval", row: 2, col: 2, dir: "across" },
  ]),
});

const ctx = { params: Promise.resolve({ id: "p1" }) };
const patch = (body: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordPuzzles.get.mockResolvedValue(puzzle());
  mockDb.crosswordPuzzles.setStatus.mockResolvedValue(true);
  mockDb.crosswordPuzzles.upsert.mockImplementation(async (p: CrosswordPuzzle) => p);
  mockDb.crosswordScenes.mockResolvedValue(["xw"]);
  mockDb.getOrInitCrosswordConfig.mockResolvedValue({ ...DEFAULT_CROSSWORD_CONFIG, minWords: 2, blocklist: ["fluffy"] });
  mockDb.crosswordGames.get.mockResolvedValue(null);
});

it("is admin only, both ways", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
  expect((await patch({ action: "approve" })).status).toBe(401);
  expect(mockDb.crosswordPuzzles.get).not.toHaveBeenCalled();
});

it("serves the puzzle with its answers, 404 when unknown", async () => {
  const res = await GET(new Request("http://x"), ctx);
  expect((await res.json()).entries[0].answer).toBe("CAT");
  mockDb.crosswordPuzzles.get.mockResolvedValue(null);
  expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
  expect((await patch({ action: "approve" })).status).toBe(404);
});

it("approves to ready and rejects to rejected", async () => {
  const ok = await patch({ action: "approve" });
  expect((await ok.json()).status).toBe("ready");
  expect(mockDb.crosswordPuzzles.setStatus).toHaveBeenLastCalledWith("p1", "ready");
  const no = await patch({ action: "reject" });
  expect((await no.json()).status).toBe("rejected");
  expect(mockDb.crosswordPuzzles.setStatus).toHaveBeenLastCalledWith("p1", "rejected");
});

it("400s an unknown action or a missing entryId", async () => {
  expect((await patch({ action: "burn" })).status).toBe(400);
  expect((await patch({ action: "clue", clue: "Feline pet" })).status).toBe(400);
  expect((await patch({ action: "clue", entryId: "1A" })).status).toBe(400);
});

it("saves a cleaned clue", async () => {
  const res = await patch({ action: "clue", entryId: "1A", clue: "Purring house pet (3)" });
  expect(res.status).toBe(200);
  expect(mockDb.crosswordPuzzles.upsert.mock.calls[0][0].entries[0].clue).toBe("Purring house pet");
});

it("refuses a clue that leaks or hits a channel's blocklist", async () => {
  const leak = await patch({ action: "clue", entryId: "1A", clue: "Catnap taker, perhaps" });
  expect(leak.status).toBe(422);
  expect((await leak.json()).error).toMatch(/gives the answer away/);
  const blocked = await patch({ action: "clue", entryId: "1A", clue: "Fluffy household animal" });
  expect(blocked.status).toBe(422);
  expect(mockDb.crosswordPuzzles.upsert).not.toHaveBeenCalled();
});

it("drops a word and saves the renumbered grid", async () => {
  const res = await patch({ action: "drop", entryId: "1A" });
  expect(res.status).toBe(200);
  const saved = mockDb.crosswordPuzzles.upsert.mock.calls[0][0] as CrosswordPuzzle;
  expect(saved.entries.map((e) => e.id)).toEqual(["2A", "1D"]);
});

it("refuses a drop that splits the grid or runs short", async () => {
  const split = await patch({ action: "drop", entryId: "2D" });
  expect(split.status).toBe(422);
  expect((await split.json()).error).toMatch(/Generate/);
  mockDb.getOrInitCrosswordConfig.mockResolvedValue({ ...DEFAULT_CROSSWORD_CONFIG });
  const short = await patch({ action: "drop", entryId: "1A" });
  expect(short.status).toBe(422);
  expect((await short.json()).error).toMatch(/minimum of 10/);
  expect(mockDb.crosswordPuzzles.upsert).not.toHaveBeenCalled();
});

it("refuses a drop while a channel is playing the puzzle", async () => {
  mockDb.crosswordGames.get.mockResolvedValue({ puzzleId: "p1", phase: "playing" });
  const res = await patch({ action: "drop", entryId: "1A" });
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/xw is playing this puzzle/);
});

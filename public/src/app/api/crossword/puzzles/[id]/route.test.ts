/** @jest-environment node */

/**
 * GET/PATCH /api/crossword/puzzles/:id — admin only; PATCH accepts only
 * reject. Approve, clue edits and drops are gone (§8.3).
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = {
  crosswordPuzzles: { get: jest.fn(), setStatus: jest.fn(), upsert: jest.fn() },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { numberEntries, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
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
});

it("is admin only, both ways", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
  expect((await patch({ action: "reject" })).status).toBe(401);
  expect(mockDb.crosswordPuzzles.get).not.toHaveBeenCalled();
});

it("serves the puzzle with its answers, 404 when unknown", async () => {
  const res = await GET(new Request("http://x"), ctx);
  expect((await res.json()).entries[0].answer).toBe("CAT");
  mockDb.crosswordPuzzles.get.mockResolvedValue(null);
  expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
  expect((await patch({ action: "reject" })).status).toBe(404);
});

it("rejects to rejected", async () => {
  const no = await patch({ action: "reject" });
  expect((await no.json()).status).toBe("rejected");
  expect(mockDb.crosswordPuzzles.setStatus).toHaveBeenLastCalledWith("p1", "rejected");
});

it("accepts nothing else: no approve, unreject, clue or drop", async () => {
  for (const body of [{ action: "approve" }, { action: "unreject" }, { action: "clue", entryId: "1A", clue: "Feline pet" }, { action: "drop", entryId: "1A" }, {}]) {
    expect((await patch(body)).status).toBe(400);
  }
  expect(mockDb.crosswordPuzzles.setStatus).not.toHaveBeenCalled();
  expect(mockDb.crosswordPuzzles.upsert).not.toHaveBeenCalled();
});

/** @jest-environment node */

/**
 * Plan §7.5, §8.3, §8.4 — GET /api/crossword/puzzles: admin only, wrapped in
 * withApiLog, and the stock list never carries an answer.
 */
jest.mock("../../../../lib/api-log", () => ({
  withApiLog: (h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true }),
}));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = { crosswordPuzzles: { list: jest.fn(), get: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { numberEntries, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { requireAdmin } from "../../../../lib/require-admin";
import { GET } from "./route";

const puzzle = (id: string, over: Partial<CrosswordPuzzle> = {}): CrosswordPuzzle => ({
  id,
  title: `Puzzle ${id}`,
  width: 9,
  height: 3,
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 1000,
  plays: [{ sceneId: "xw", startedAt: 2000, endedAt: 3000 }],
  entries: numberEntries([
    { answer: "ZEPHYRQUA", clue: "A secret clue", row: 0, col: 0, dir: "across" },
    { answer: "ZOX", clue: "Another", row: 0, col: 0, dir: "down" },
  ]).map((e, i) => ({ ...e, wordId: `w${i}`, clueId: `c${i}` })),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
  mockDb.crosswordPuzzles.list.mockResolvedValue([puzzle("p1"), puzzle("p2", { familyFriendly: false, status: "rejected" })]);
});

it("is wrapped in withApiLog", () => {
  expect((GET as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("401s a non-admin and reads nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  const res = await GET(new Request("http://x/api/crossword/puzzles"));
  expect(res.status).toBe(401);
  expect(mockDb.crosswordPuzzles.list).not.toHaveBeenCalled();
});

it("lists the stock with the family-friendly flag, source and plays, and never an answer", async () => {
  const res = await GET(new Request("http://x/api/crossword/puzzles"));
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toMatch(/ZEPHYRQUA/);
  expect(text).not.toMatch(/ZOX/);
  expect(text).not.toMatch(/"answer"/);
  const body = JSON.parse(text);
  const rows = body.puzzles as Record<string, unknown>[];
  expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
  expect(rows[0]).toMatchObject({ familyFriendly: true, source: "bank" });
  expect(rows[1]).toMatchObject({ familyFriendly: false, status: "rejected" });
  expect(rows[0].plays).toBeTruthy();
});

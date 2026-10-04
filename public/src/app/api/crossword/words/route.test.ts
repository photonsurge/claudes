/** @jest-environment node */

/**
 * GET /api/crossword/words — admin-only; forwards the parsed filters to the
 * bank repo and adds the totals and whether the bank is imported.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = { crosswordBank: { listWords: jest.fn(), totals: jest.fn(), poolCounts: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { GET } from "./route";

const totals = { byClueStatus: { done: 2 }, byDecision: { accept: 2 }, byBand: { common: 2 }, total: 2 };
const pool = { words: 3, ffWords: 2, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0, targetWords: 280 };
const row = { id: "a1", word: "wreck", length: 5, pos: ["noun"], categories: [], flags: {}, clueCount: 5 };

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op@example.com" });
  mockDb.crosswordBank.listWords.mockResolvedValue({ rows: [row], total: 1, page: 1, pageSize: 50 });
  mockDb.crosswordBank.totals.mockResolvedValue(totals);
  mockDb.crosswordBank.poolCounts.mockResolvedValue(pool);
});

it("401s for non-admins without touching the bank", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  const res = await GET(new Request("http://x/api/crossword/words"));
  expect(res.status).toBe(401);
  expect(mockDb.crosswordBank.listWords).not.toHaveBeenCalled();
});

it("lists with the filters from the query string", async () => {
  const res = await GET(new Request("http://x/api/crossword/words?letter=w&status=done&accepted=1&size=25&junk=1"));
  expect(res.status).toBe(200);
  expect(mockDb.crosswordBank.listWords).toHaveBeenCalledWith({
    startsWith: "W",
    clueStatus: "done",
    acceptedOnly: true,
    pageSize: 25,
  });
  expect(await res.json()).toEqual({ rows: [row], total: 1, page: 1, pageSize: 50, totals, pool, imported: true });
});

it("reports an unimported bank", async () => {
  mockDb.crosswordBank.listWords.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
  mockDb.crosswordBank.totals.mockResolvedValue({ byClueStatus: {}, byDecision: {}, byBand: {}, total: 0 });
  const body = await (await GET(new Request("http://x/api/crossword/words"))).json();
  expect(body.imported).toBe(false);
});

it("filters on approval and family friendly, and returns the pool counter", async () => {
  const res = await GET(new Request("http://x/api/crossword/words?approval=approved&ff=untagged"));
  expect(mockDb.crosswordBank.listWords).toHaveBeenCalledWith({ approval: "approved", familyFriendly: "untagged" });
  expect((await res.json()).pool).toEqual(pool);
});

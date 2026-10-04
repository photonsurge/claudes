/** @jest-environment node */

/**
 * GET /api/crossword/words against docs/crossword-mode-plan.md §8.3 and the
 * batch's intent: the Words list caps its count, and the page is told when
 * the count it got is the cap ("10,000+") rather than exact.
 */
jest.mock("../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const mockDb = { crosswordBank: { listWords: jest.fn(), totals: jest.fn(), poolCounts: jest.fn() } };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../lib/require-admin";
import { GET } from "./route";

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op@example.com" });
  mockDb.crosswordBank.totals.mockResolvedValue({ byClueStatus: {}, byDecision: {}, byBand: {}, total: 1_000_000 });
  mockDb.crosswordBank.poolCounts.mockResolvedValue({ words: 0, ffWords: 0, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0, targetWords: 280 });
});

it("passes a capped count through, marked capped", async () => {
  mockDb.crosswordBank.listWords.mockResolvedValue({ rows: [], total: 10_000, totalCapped: true, page: 1, pageSize: 50 });
  const res = await GET(new Request("http://x/api/crossword/words?letter=s"));
  expect(await res.json()).toMatchObject({ total: 10_000, totalCapped: true });
});

it("an exact count is not marked capped", async () => {
  mockDb.crosswordBank.listWords.mockResolvedValue({ rows: [], total: 42, totalCapped: false, page: 1, pageSize: 50 });
  const body = await (await GET(new Request("http://x/api/crossword/words?letter=s"))).json();
  expect(body.total).toBe(42);
  expect(body.totalCapped).not.toBe(true);
});

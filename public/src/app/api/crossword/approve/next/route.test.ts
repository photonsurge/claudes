/** @jest-environment node */

/** GET /api/crossword/approve/next — admin-only; the queue's next words with filters, plus the pool. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const bank = { approvalQueue: jest.fn(), poolCounts: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ crosswordBank: bank }) }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { GET } from "./route";

const pool = { words: 1, ffWords: 1, puzzlesWithoutRepeat: 0, ffPuzzlesWithoutRepeat: 0, targetWords: 280 };
const get = (qs = "") => GET(new Request(`http://x/api/crossword/approve/next${qs}`));

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ sub: "u1", email: "op@example.com", role: "admin" });
  bank.approvalQueue.mockResolvedValue([{ id: "w1" }]);
  bank.poolCounts.mockResolvedValue(pool);
});

it("401s for non-admins without touching the bank", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  expect(bank.approvalQueue).not.toHaveBeenCalled();
});

it("passes the filters and skipped ids to the queue, and returns words and pool", async () => {
  const a = "64b000000000000000000001";
  const res = await get(`?band=common&min=4&max=7&letter=w&suggestions=1&exclude=${a},junk&limit=5`);
  expect(res.status).toBe(200);
  expect(bank.approvalQueue).toHaveBeenCalledWith({
    band: "common",
    minLength: 4,
    maxLength: 7,
    startsWith: "W",
    withSuggestions: true,
    excludeIds: [a],
    limit: 5,
  });
  expect(await res.json()).toEqual({ words: [{ id: "w1" }], pool });
});

it("defaults to a few words and caps the limit", async () => {
  await get();
  expect(bank.approvalQueue).toHaveBeenLastCalledWith({ limit: 3 });
  await get("?limit=9999&band=nope&min=2");
  expect(bank.approvalQueue).toHaveBeenLastCalledWith({ limit: 50 });
});

it("treats band=none as no band for the queue", async () => {
  await get("?band=none");
  expect(bank.approvalQueue).toHaveBeenLastCalledWith({ limit: 3 });
});

/** @jest-environment node */

/**
 * GET /api/crossword/words, from the plan (§8.3 Words list, §8.4, §12 public):
 * admin-only and wrapped in withApiLog; the approval (pending / approved /
 * rejected) and family-friendly (yes / no / untagged) filters reach the bank
 * and build the right query; the approved-pool counter comes back with the
 * list.
 */
jest.mock("../../../../lib/api-log", () => ({
  withApiLog: jest.fn((h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true })),
}));
jest.mock("../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const bank = { listWords: jest.fn(), totals: jest.fn(), poolCounts: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ crosswordBank: bank }) }));

import { bankWordFilter, type BankWordQuery } from "@photonsurge/shared/crossword-bank";
import { requireAdmin } from "../../../../lib/require-admin";
import { GET } from "./route";

// sift evaluates a Mongo filter in memory (it is what mongoose's own tests use).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sift = require("sift").default as (f: unknown) => (d: unknown) => boolean;

const pool = { words: 300, ffWords: 140, puzzlesWithoutRepeat: 21, ffPuzzlesWithoutRepeat: 10, targetWords: 280 };
const totals = { byClueStatus: { done: 2 }, byDecision: { accepted: 2 }, byBand: { common: 2 }, total: 2 };
const get = (qs = "") => GET(new Request(`http://x/api/crossword/words${qs}`));

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ sub: "u1", email: "op@example.com", role: "admin" });
  bank.listWords.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
  bank.totals.mockResolvedValue(totals);
  bank.poolCounts.mockResolvedValue(pool);
});

it("is wrapped in withApiLog", () => {
  expect((GET as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("refuses a non-admin and reads nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  const res = await get("?approval=approved");
  expect(res.status).toBe(401);
  expect(bank.listWords).not.toHaveBeenCalled();
  expect(bank.poolCounts).not.toHaveBeenCalled();
});

it.each([
  ["approval=pending", { approval: "pending" }],
  ["approval=approved", { approval: "approved" }],
  ["approval=rejected", { approval: "rejected" }],
  ["ff=yes", { familyFriendly: "yes" }],
  ["ff=no", { familyFriendly: "no" }],
  ["ff=untagged", { familyFriendly: "untagged" }],
  ["approval=approved&ff=yes", { approval: "approved", familyFriendly: "yes" }],
])("passes %s to the bank list", async (qs, expected) => {
  const res = await get(`?${qs}`);
  expect(res.status).toBe(200);
  expect(bank.listWords).toHaveBeenCalledWith(expect.objectContaining(expected));
});

it("drops an unknown approval or family-friendly value", async () => {
  await get("?approval=maybe&ff=sometimes");
  const q = bank.listWords.mock.calls[0][0] as BankWordQuery;
  expect(q.approval).toBeUndefined();
  expect(q.familyFriendly).toBeUndefined();
});

it("returns the approved-pool counter with the list", async () => {
  const body = await (await get()).json();
  expect(body.pool).toEqual(pool);
  expect(body.totals).toEqual(totals);
});

describe("the query the filters build", () => {
  // Imported words start pending and untagged; the app's fields may be absent.
  const docs = [
    { _id: 1, norm: "IMPORTED" },
    { _id: 2, norm: "PENDING", approval: { status: "pending" }, familyFriendly: null },
    { _id: 3, norm: "APPROVED", approval: { status: "approved", by: "op", at: 1 }, familyFriendly: true },
    { _id: 4, norm: "REJECTED", approval: { status: "rejected", by: "op", at: 1 }, familyFriendly: false },
    { _id: 5, norm: "OKNOTFF", approval: { status: "approved", by: "op", at: 1 }, familyFriendly: false },
  ];
  const ids = (q: BankWordQuery) => docs.filter(sift(bankWordFilter(q))).map((d) => d._id);

  it("approval: pending includes never-decided words", () => {
    expect(ids({ approval: "pending" })).toEqual([1, 2]);
    expect(ids({ approval: "approved" })).toEqual([3, 5]);
    expect(ids({ approval: "rejected" })).toEqual([4]);
  });

  it("family friendly: yes, no, untagged (null or missing)", () => {
    expect(ids({ familyFriendly: "yes" })).toEqual([3]);
    expect(ids({ familyFriendly: "no" })).toEqual([4, 5]);
    expect(ids({ familyFriendly: "untagged" })).toEqual([1, 2]);
  });

  it("combines with the other filters", () => {
    expect(ids({ approval: "approved", familyFriendly: "no" })).toEqual([5]);
    expect(ids({ approval: "approved", startsWith: "O" })).toEqual([5]);
  });
});

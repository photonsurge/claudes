/** @jest-environment node */

/**
 * GET /api/crossword/approve/next, from the plan (§7.4 queue, §8.4): admin-only
 * and wrapped in withApiLog; pending words, most common first, filtered by
 * frequency band, length, starts-with and "only with suggestions", leaving out
 * the ids the operator skipped; the pool counter comes back too.
 *
 * The route hands the filters to the bank; the order and the filter itself
 * are the shared queue query, checked here in memory against a small fixture.
 */
jest.mock("../../../../../lib/api-log", () => ({
  withApiLog: jest.fn((h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true })),
}));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const bank = { approvalQueue: jest.fn(), poolCounts: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ crosswordBank: bank }) }));

import { BANK_QUEUE_SORT, bankQueueFilter, type BankQueueQuery } from "@photonsurge/shared/crossword-bank";
import { requireAdmin } from "../../../../../lib/require-admin";
import { GET } from "./route";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const siftRaw = require("sift").default as (f: unknown) => (d: unknown) => boolean;
/** sift knows `$type: "object"` only as the Object constructor. */
const typeAliases = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(typeAliases)
    : v && typeof v === "object" && !(v instanceof RegExp)
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "$type" && x === "object" ? Object : typeAliases(x)]))
      : v;
const sift = (f: unknown) => siftRaw(typeAliases(f));

const pool = { words: 28, ffWords: 14, puzzlesWithoutRepeat: 2, ffPuzzlesWithoutRepeat: 1, targetWords: 280 };
const get = (qs = "") => GET(new Request(`http://x/api/crossword/approve/next${qs}`));
const A = "64b000000000000000000001";
const B = "64b000000000000000000002";

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ sub: "u1", email: "op@example.com", role: "admin" });
  bank.approvalQueue.mockResolvedValue([]);
  bank.poolCounts.mockResolvedValue(pool);
});

it("is wrapped in withApiLog", () => {
  expect((GET as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("refuses a non-admin, reading nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await get()).status).toBe(401);
  expect(bank.approvalQueue).not.toHaveBeenCalled();
  expect(bank.poolCounts).not.toHaveBeenCalled();
});

it("returns the queue's words in the bank's order, with the pool counter", async () => {
  const words = [{ id: A, norm: "WATER" }, { id: B, norm: "WAGES" }];
  bank.approvalQueue.mockResolvedValue(words);
  const res = await get();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ words, pool });
});

it.each([
  ["band=everyday", { band: "everyday" }],
  ["min=5&max=7", { minLength: 5, maxLength: 7 }],
  ["letter=q", { startsWith: "Q" }],
  ["suggestions=1", { withSuggestions: true }],
  [`exclude=${A},${B}`, { excludeIds: [A, B] }],
])("hands %s to the queue", async (qs, expected) => {
  await get(`?${qs}`);
  expect(bank.approvalQueue).toHaveBeenCalledWith(expect.objectContaining(expected));
});

it("leaves out filters it does not know", async () => {
  await get("?band=huge&letter=12&suggestions=0&min=x");
  const q = bank.approvalQueue.mock.calls[0][0] as BankQueueQuery;
  expect(q.band).toBeUndefined();
  expect(q.startsWith).toBeUndefined();
  expect(q.withSuggestions).toBeFalsy();
  expect(q.minLength).toBeUndefined();
});

describe("the queue query (pending, most common first, filtered)", () => {
  type Doc = Record<string, unknown> & { _id: number; norm: string };
  const doc = (_id: number, norm: string, zipf: number, over: Record<string, unknown> = {}): Doc => ({
    _id,
    norm,
    length: norm.length,
    enrichment: { status: "done" },
    validation: { decision: "accepted", sources: { wordfreq: { zipf } } },
    ...over,
  });
  const docs: Doc[] = [
    doc(1, "WATER", 5.6),
    doc(2, "WAGES", 4.3, { suggestion: { clue: "Pay", familyFriendly: true, reason: "", model: "m", at: 1 } }),
    doc(3, "QUIET", 4.8, { approval: { status: "pending" } }),
    doc(4, "HOUSE", 5.9, { approval: { status: "approved", by: "op", at: 1 } }),
    doc(5, "TRASH", 4.1, { approval: { status: "rejected", by: "op", at: 1 } }),
    doc(6, "SEASHELL", 3.5),
    doc(7, "VULGAR", 4.6, { flags: { vulgar: true } }),
  ];
  // The repo runs two tiers (preferred lengths, then the rest); merge them in that order.
  const run = (q: Omit<BankQueueQuery, "limit">): string[] => {
    const sortKey = Object.keys(BANK_QUEUE_SORT)[0];
    const z = (d: Doc) => Number(sortKey.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], d) ?? -Infinity);
    const out: string[] = [];
    for (const tier of ["preferred", "rest"] as const) {
      const f = bankQueueFilter(q, tier);
      out.push(
        ...docs
          .filter(sift(f))
          .filter((d) => !(q.excludeIds ?? []).includes(String(d._id)))
          .sort((a, b) => (BANK_QUEUE_SORT[sortKey] === -1 ? z(b) - z(a) : z(a) - z(b)))
          .map((d) => d.norm),
      );
    }
    return out;
  };

  it("sorts most common first", () => {
    expect(Object.values(BANK_QUEUE_SORT)[0]).toBe(-1);
    expect(Object.keys(BANK_QUEUE_SORT)[0]).toMatch(/zipf/);
  });

  it("holds pending words only (never-decided counts as pending), flagged ones included", () => {
    expect(run({})).toEqual(["WATER", "QUIET", "VULGAR", "WAGES", "SEASHELL"]);
  });

  it("filters by frequency band", () => {
    expect(run({ band: "everyday" })).toEqual(["WATER"]);
    expect(run({ band: "common" })).toEqual(["QUIET", "VULGAR", "WAGES"]);
  });

  it("filters by length", () => {
    expect(run({ minLength: 6 })).toEqual(["VULGAR", "SEASHELL"]);
    expect(run({ minLength: 5, maxLength: 5 })).toEqual(["WATER", "QUIET", "WAGES"]);
  });

  it("filters by starts-with", () => {
    expect(run({ startsWith: "W" })).toEqual(["WATER", "WAGES"]);
  });

  it("filters to words with a suggestion", () => {
    expect(run({ withSuggestions: true })).toEqual(["WAGES"]);
  });

  it("leaves out skipped ids", () => {
    expect(run({ excludeIds: ["1", "3"] })).toEqual(["VULGAR", "WAGES", "SEASHELL"]);
  });
});

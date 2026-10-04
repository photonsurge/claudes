/** @jest-environment node */

/**
 * Plan §7.4, §8.3, §8.4 — GET/PATCH /api/crossword/puzzles/:id. Admin only,
 * withApiLog. The detail carries the answers (admins only). PATCH is reject:
 * nothing here may approve, edit a clue or drop a word, so nothing on the
 * Puzzles page bypasses word and clue approval.
 */
jest.mock("../../../../../lib/api-log", () => ({
  withApiLog: (h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true }),
}));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

/** Records every repo call, whatever the method is called. */
const writes: { repo: string; method: string; args: unknown[] }[] = [];
const recorder = (repo: string, impl: Record<string, (...a: unknown[]) => unknown> = {}) =>
  new Proxy(
    {},
    {
      get: (_t, method: string) => async (...args: unknown[]) => {
        writes.push({ repo, method, args });
        return impl[method] ? impl[method](...args) : true;
      },
    },
  );
let stored: unknown = null;
const mockDb = {
  crosswordPuzzles: recorder("puzzles", { get: () => stored, getById: () => stored }),
  crosswordBank: recorder("bank"),
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
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 1,
  plays: [],
  entries: numberEntries([
    { answer: "CAT", clue: "Feline pet", row: 0, col: 0, dir: "across" },
    { answer: "TOE", clue: "Digit on a foot", row: 0, col: 2, dir: "down" },
    { answer: "EGG", clue: "Breakfast oval", row: 2, col: 2, dir: "across" },
  ]).map((e, i) => ({ ...e, wordId: `w${i}`, clueId: `c${i}` })),
});

const ctx = { params: Promise.resolve({ id: "p1" }) };
const patch = (body: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), ctx);
const reads = new Set(["get", "getById", "find", "findById"]);
const mutations = () => writes.filter((w) => !reads.has(w.method));

beforeEach(() => {
  writes.length = 0;
  stored = puzzle();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op" });
});

it("wraps both handlers in withApiLog", () => {
  expect((GET as unknown as { __logged?: boolean }).__logged).toBe(true);
  expect((PATCH as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("401s a non-admin both ways, with no answer and no write", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  const g = await GET(new Request("http://x"), ctx);
  expect(g.status).toBe(401);
  expect(await g.text()).not.toMatch(/CAT|TOE|EGG/);
  expect((await patch({ action: "reject" })).status).toBe(401);
  expect(mutations()).toEqual([]);
});

it("gives an admin the grid with its answers", async () => {
  const res = await GET(new Request("http://x"), ctx);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.entries.map((e: { answer: string }) => e.answer).sort()).toEqual(["CAT", "EGG", "TOE"]);
  expect(body.entries[0]).toHaveProperty("wordId");
  expect(body.familyFriendly).toBe(true);
});

it("404s an unknown puzzle", async () => {
  stored = null;
  expect((await GET(new Request("http://x"), ctx)).status).toBe(404);
});

it("accepts reject, which takes the puzzle out of play", async () => {
  const res = await patch({ action: "reject" });
  expect(res.status).toBe(200);
  expect((await res.json()).status).toBe("rejected");
  const m = mutations();
  expect(m.length).toBeGreaterThan(0);
  expect(m.every((w) => w.repo === "puzzles")).toBe(true);
  expect(JSON.stringify(m)).toMatch(/rejected/);
  expect(JSON.stringify(m)).not.toMatch(/Feline pet|"approved"/);
});

it.each([
  ["approve", { action: "approve" }],
  ["approved status", { status: "approved" }],
  ["ready status", { status: "ready" }],
  ["approve with reject alongside", { action: "approve", status: "rejected" }],
  ["edit a clue", { action: "clue", entryId: "1A", clue: "Purring pet" }],
  ["edit clues", { action: "editClue", entryId: "1A", clue: "Purring pet" }],
  ["replace entries", { entries: [] }],
  ["drop a word", { action: "drop", entryId: "1A" }],
  ["drop a word, other spelling", { action: "dropWord", entryId: "1A" }],
  ["nothing", {}],
])("refuses %s, writing nothing", async (_label, body) => {
  const res = await patch(body);
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect(mutations()).toEqual([]);
});

it("ignores clue or entry fields smuggled in beside reject", async () => {
  const res = await patch({ action: "reject", clue: "Purring pet", entries: [], familyFriendly: false });
  expect(res.status).toBe(200);
  for (const w of mutations()) {
    expect(JSON.stringify(w.args)).not.toMatch(/Purring pet|"entries"|familyFriendly/);
  }
});

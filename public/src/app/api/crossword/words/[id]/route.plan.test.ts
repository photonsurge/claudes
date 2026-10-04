/** @jest-environment node */

/**
 * GET and PATCH /api/crossword/words/:id, from the plan (§7.4, §8.3 Detail,
 * §8.4): admin-only and wrapped in withApiLog; approve / reject / back to
 * pending and the family-friendly tag, each passed the session's identity as
 * who decided; the bank's model flags never decide; accepting a suggestion
 * only adds a candidate clue and approves nothing.
 */
jest.mock("../../../../../lib/api-log", () => ({
  withApiLog: jest.fn((h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true })),
}));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const bank = {
  getWordById: jest.fn(),
  setWordApproval: jest.fn(),
  setWordFamilyFriendly: jest.fn(),
  setClueApproval: jest.fn(),
  setClueFamilyFriendly: jest.fn(),
  editClue: jest.fn(),
  addClues: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ crosswordBank: bank }) }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { GET, PATCH } from "./route";

const ID = "64b0000000000000000000aa";
const ctx = { params: Promise.resolve({ id: ID }) };
const ADMIN = { sub: "u-42", email: "op@example.com", role: "admin" };

const word = (over: Record<string, unknown> = {}) => ({
  id: ID,
  word: "excited",
  length: 7,
  pos: [],
  categories: [],
  flags: { adult: true, vulgar: true },
  warnings: ["adult", "vulgar"],
  approval: { status: "pending" },
  familyFriendly: null,
  clueCount: 1,
  senses: [],
  definitions: [],
  clues: [{ id: "c1", text: "Aroused", approval: { status: "pending" }, familyFriendly: null }],
  raw: {},
  ...over,
});

const patch = (body: unknown) =>
  PATCH(new Request(`http://x/api/crossword/words/${ID}`, { method: "PATCH", body: JSON.stringify(body) }), ctx);

const noDecisions = () => {
  expect(bank.setWordApproval).not.toHaveBeenCalled();
  expect(bank.setWordFamilyFriendly).not.toHaveBeenCalled();
  expect(bank.setClueApproval).not.toHaveBeenCalled();
  expect(bank.setClueFamilyFriendly).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue(ADMIN);
  bank.getWordById.mockResolvedValue(word());
  for (const f of [bank.setWordApproval, bank.setWordFamilyFriendly, bank.setClueApproval, bank.setClueFamilyFriendly, bank.editClue]) {
    f.mockResolvedValue(true);
  }
  bank.addClues.mockResolvedValue(1);
});

it("wraps GET and PATCH in withApiLog", () => {
  expect((GET as unknown as { __logged?: boolean }).__logged).toBe(true);
  expect((PATCH as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("refuses a non-admin on GET and PATCH, touching nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await GET(new Request(`http://x/api/crossword/words/${ID}`), ctx)).status).toBe(401);
  expect((await patch({ approval: "approved" })).status).toBe(401);
  expect(bank.getWordById).not.toHaveBeenCalled();
  noDecisions();
});

it("GET returns the word's detail, 404 for an unknown one", async () => {
  const res = await GET(new Request(`http://x/api/crossword/words/${ID}`), ctx);
  expect(res.status).toBe(200);
  expect((await res.json()).word).toBe("excited");
  bank.getWordById.mockResolvedValue(null);
  expect((await GET(new Request(`http://x/api/crossword/words/${ID}`), ctx)).status).toBe(404);
});

it.each(["approved", "rejected", "pending"] as const)("records %s with the session's identity as who", async (status) => {
  const res = await patch({ approval: status });
  expect(res.status).toBe(200);
  expect(bank.setWordApproval).toHaveBeenCalledWith(ID, status, "op@example.com");
  expect(bank.setWordFamilyFriendly).not.toHaveBeenCalled();
});

it("falls back to the session's subject when it has no email", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue({ sub: "u-42", role: "admin" });
  await patch({ approval: "approved" });
  expect(bank.setWordApproval).toHaveBeenCalledWith(ID, "approved", "u-42");
});

it("never takes who decided from the body", async () => {
  await patch({ approval: "approved", by: "someone-else" });
  expect(bank.setWordApproval).toHaveBeenCalledWith(ID, "approved", "op@example.com");
});

it.each([true, false, null])("tags family friendly %p with who", async (v) => {
  const res = await patch({ familyFriendly: v });
  expect(res.status).toBe(200);
  expect(bank.setWordFamilyFriendly).toHaveBeenCalledWith(ID, v, "op@example.com");
  expect(bank.setWordApproval).not.toHaveBeenCalled();
});

it("applies approval and the tag together", async () => {
  await patch({ approval: "approved", familyFriendly: true });
  expect(bank.setWordApproval).toHaveBeenCalledWith(ID, "approved", "op@example.com");
  expect(bank.setWordFamilyFriendly).toHaveBeenCalledWith(ID, true, "op@example.com");
});

it("returns the word as it now is", async () => {
  bank.getWordById.mockResolvedValueOnce(word()).mockResolvedValueOnce(word({ approval: { status: "approved", by: "op@example.com", at: 5 } }));
  const body = await (await patch({ approval: "approved" })).json();
  expect(body.approval).toEqual({ status: "approved", by: "op@example.com", at: 5 });
});

it("refuses an empty or malformed body", async () => {
  expect((await patch({})).status).toBe(400);
  expect((await patch({ approval: "maybe" })).status).toBe(400);
  expect((await patch({ familyFriendly: "yes" })).status).toBe(400);
  const bad = await PATCH(new Request(`http://x/api/crossword/words/${ID}`, { method: "PATCH", body: "{not json" }), ctx);
  expect(bad.status).toBe(400);
  noDecisions();
});

it("404s for an unknown word", async () => {
  bank.getWordById.mockResolvedValue(null);
  expect((await patch({ approval: "approved" })).status).toBe(404);
  noDecisions();
});

it("does not let the bank's adult / vulgar flags decide the tag", async () => {
  // A flagged word approved: only the approval is written; the tag stays the operator's.
  await patch({ approval: "approved" });
  expect(bank.setWordFamilyFriendly).not.toHaveBeenCalled();
  // And the operator may still tag a flagged word family friendly.
  await patch({ familyFriendly: true });
  expect(bank.setWordFamilyFriendly).toHaveBeenCalledWith(ID, true, "op@example.com");
});

describe("accepting a suggestion", () => {
  const suggestion = { clue: "Eager with anticipation", familyFriendly: true, reason: "plain sense", model: "m1", at: 1 };

  it("adds the suggested clue as a candidate and approves nothing", async () => {
    bank.getWordById.mockResolvedValue(word({ suggestion }));
    const res = await patch({ acceptSuggestion: true });
    expect(res.status).toBe(200);
    expect(bank.addClues).toHaveBeenCalledTimes(1);
    expect(bank.addClues.mock.calls[0][0]).toBe(ID);
    expect(bank.addClues.mock.calls[0][1]).toEqual(["Eager with anticipation"]);
    // The suggestion's family-friendly opinion is not applied either.
    noDecisions();
    // Nothing in the call asks for the new clue to be approved.
    expect(JSON.stringify(bank.addClues.mock.calls[0][2] ?? {})).not.toMatch(/approved/);
  });

  it("refuses when there is no suggestion, adding nothing", async () => {
    const res = await patch({ acceptSuggestion: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(bank.addClues).not.toHaveBeenCalled();
    noDecisions();
  });
});

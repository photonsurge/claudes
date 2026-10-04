/** @jest-environment node */

/** PATCH /api/crossword/words/:id — admin-only; word approval, tag and accepting a suggestion. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const bank = {
  getWordById: jest.fn(),
  setWordApproval: jest.fn(),
  setWordFamilyFriendly: jest.fn(),
  addClues: jest.fn(),
};
// The db facade's cascading decisions (§7.4), passed through to the bank fakes.
const facadeCalls: string[] = [];
const cascade = (name: string, f: (...a: never[]) => unknown) => async (...a: unknown[]) => {
  facadeCalls.push(name);
  return { ok: !!(await (f as (...x: unknown[]) => unknown)(...a)), rejected: [], untagged: [] };
};
const facade = () => ({
  setCrosswordWordApproval: cascade("setCrosswordWordApproval", bank.setWordApproval),
  setCrosswordWordFamilyFriendly: cascade("setCrosswordWordFamilyFriendly", bank.setWordFamilyFriendly),
});
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ crosswordBank: bank, ...facade() }) }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { PATCH } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), ctx("w1"));

beforeEach(() => {
  jest.resetAllMocks();
  facadeCalls.length = 0;
  (requireAdmin as jest.Mock).mockResolvedValue({ sub: "u1", email: "op@example.com", role: "admin" });
  bank.getWordById.mockResolvedValue({ id: "w1", word: "wreck", clues: [] });
});

it("401s for non-admins without touching the bank", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await patch({ approval: "approved" })).status).toBe(401);
  expect(bank.setWordApproval).not.toHaveBeenCalled();
});

it("approves and tags with the admin's identity, answering with the word", async () => {
  const res = await patch({ approval: "approved", familyFriendly: true });
  expect(res.status).toBe(200);
  expect(bank.setWordApproval).toHaveBeenCalledWith("w1", "approved", "op@example.com");
  expect(bank.setWordFamilyFriendly).toHaveBeenCalledWith("w1", true, "op@example.com");
  expect((await res.json()).id).toBe("w1");
  // Through the facade, so the decision reaches built puzzles (§7.4).
  expect(facadeCalls).toEqual(["setCrosswordWordApproval", "setCrosswordWordFamilyFriendly"]);
});

it("lets familyFriendly be cleared with null", async () => {
  expect((await patch({ familyFriendly: null })).status).toBe(200);
  expect(bank.setWordFamilyFriendly).toHaveBeenCalledWith("w1", null, "op@example.com");
});

it("rejects an empty or malformed body", async () => {
  expect((await patch({})).status).toBe(400);
  expect((await patch({ approval: "maybe" })).status).toBe(400);
  expect((await patch({ familyFriendly: "yes" })).status).toBe(400);
  expect(bank.setWordApproval).not.toHaveBeenCalled();
});

it("404s an unknown word", async () => {
  bank.getWordById.mockResolvedValue(null);
  expect((await patch({ approval: "approved" })).status).toBe(404);
});

it("accepting a suggestion adds a candidate clue and approves nothing", async () => {
  bank.getWordById.mockResolvedValue({ id: "w1", clues: [], suggestion: { clue: "Ship's sad remains", model: "m", familyFriendly: true, reason: "", at: 1 } });
  const res = await patch({ acceptSuggestion: true });
  expect(res.status).toBe(200);
  expect(bank.addClues).toHaveBeenCalledWith("w1", ["Ship's sad remains"], { source: "suggestion", model: "m" });
  expect(bank.setWordApproval).not.toHaveBeenCalled();
});

it("409s accepting when no suggestion is stored", async () => {
  expect((await patch({ acceptSuggestion: true })).status).toBe(409);
  expect(bank.addClues).not.toHaveBeenCalled();
});

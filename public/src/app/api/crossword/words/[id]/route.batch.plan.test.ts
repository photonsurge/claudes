/** @jest-environment node */

/**
 * PATCH /api/crossword/words/:id against docs/crossword-mode-plan.md §7.4 and
 * §8.4, written from the batch's intent: a word rejected or returned to
 * pending takes every ready puzzle using it out of play, and a tag taken off
 * clears familyFriendly on them. So every word decision goes through the db
 * facade's cascading writes, never straight to the bank repo.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const ok = { ok: true, rejected: [], untagged: [] };
const mockDb = {
  crosswordBank: {
    getWordById: jest.fn(),
    setWordApproval: jest.fn(async () => true),
    setWordFamilyFriendly: jest.fn(async () => true),
    addClues: jest.fn(),
  },
  setCrosswordWordApproval: jest.fn(),
  setCrosswordWordFamilyFriendly: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { PATCH } from "./route";

const WORD = "64b0000000000000000000a1";
const patch = async (body: unknown) => {
  const res = await PATCH(new Request(`http://x/api/crossword/words/${WORD}`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: WORD }),
  });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op@example.com", sub: "op" });
  mockDb.crosswordBank.getWordById.mockResolvedValue({ id: WORD, word: "orbit", clues: [] });
  mockDb.setCrosswordWordApproval.mockResolvedValue(ok);
  mockDb.setCrosswordWordFamilyFriendly.mockResolvedValue(ok);
});

it.each(["rejected", "pending", "approved"] as const)("approval %s goes through the cascade, by the session's admin", async (status) => {
  expect((await patch({ approval: status })).status).toBe(200);
  expect(mockDb.setCrosswordWordApproval).toHaveBeenCalledWith(WORD, status, "op@example.com");
  expect(mockDb.crosswordBank.setWordApproval).not.toHaveBeenCalled();
});

it.each([false, null, true])("family friendly %p goes through the cascade", async (value) => {
  expect((await patch({ familyFriendly: value })).status).toBe(200);
  expect(mockDb.setCrosswordWordFamilyFriendly).toHaveBeenCalledWith(WORD, value, "op@example.com");
  expect(mockDb.crosswordBank.setWordFamilyFriendly).not.toHaveBeenCalled();
});

it("an unknown word is 404 and no decision is written", async () => {
  mockDb.crosswordBank.getWordById.mockResolvedValue(null);
  expect((await patch({ approval: "rejected" })).status).toBe(404);
  expect(mockDb.setCrosswordWordApproval).not.toHaveBeenCalled();
});

it("a non-admin is refused", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await patch({ approval: "rejected" })).status).toBe(401);
  expect(mockDb.setCrosswordWordApproval).not.toHaveBeenCalled();
});

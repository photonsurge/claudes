/** @jest-environment node */

/**
 * PATCH /api/crossword/clues/:id, from the plan (§7.4, §8.3 Detail, §8.4):
 * admin-only and wrapped in withApiLog; approve, reject, edit and the
 * family-friendly tag, each passed the session's identity as who decided; an
 * edit of an approved clue comes back pending (the route never re-approves an
 * edit on its own).
 */
jest.mock("../../../../../lib/api-log", () => ({
  withApiLog: jest.fn((h: (...a: unknown[]) => unknown) => Object.assign((...a: unknown[]) => h(...a), { __logged: true })),
}));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const bank = {
  editClue: jest.fn(),
  setClueApproval: jest.fn(),
  setClueFamilyFriendly: jest.fn(),
  setWordApproval: jest.fn(),
  setWordFamilyFriendly: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ crosswordBank: bank }) }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { PATCH } from "./route";

const CID = "64b0000000000000000000c1";
const ctx = { params: Promise.resolve({ id: CID }) };
const WHO = "op@example.com";

const patch = (body: unknown) =>
  PATCH(new Request(`http://x/api/crossword/clues/${CID}`, { method: "PATCH", body: JSON.stringify(body) }), ctx);

/** The order the bank was asked to do things in. */
let order: string[];

beforeEach(() => {
  jest.clearAllMocks();
  order = [];
  (requireAdmin as jest.Mock).mockResolvedValue({ sub: "u-42", email: WHO, role: "admin" });
  bank.editClue.mockImplementation(async () => (order.push("edit"), true));
  bank.setClueApproval.mockImplementation(async (_id: string, s: string) => (order.push(`approval:${s}`), true));
  bank.setClueFamilyFriendly.mockImplementation(async (_id: string, v: unknown) => (order.push(`ff:${v}`), true));
});

it("is wrapped in withApiLog", () => {
  expect((PATCH as unknown as { __logged?: boolean }).__logged).toBe(true);
});

it("refuses a non-admin, touching nothing", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await patch({ approval: "approved" })).status).toBe(401);
  expect(order).toEqual([]);
});

it.each(["approved", "rejected", "pending"] as const)("records %s with the session's identity", async (s) => {
  expect((await patch({ approval: s })).status).toBe(200);
  expect(bank.setClueApproval).toHaveBeenCalledWith(CID, s, WHO);
  expect(bank.editClue).not.toHaveBeenCalled();
  expect(bank.setClueFamilyFriendly).not.toHaveBeenCalled();
});

it.each([true, false, null])("tags the clue family friendly %p with who", async (v) => {
  expect((await patch({ familyFriendly: v })).status).toBe(200);
  expect(bank.setClueFamilyFriendly).toHaveBeenCalledWith(CID, v, WHO);
  expect(bank.setClueApproval).not.toHaveBeenCalled();
});

it("edits the text with who, and does not approve the edit", async () => {
  expect((await patch({ text: "Remains of a ruined ship" })).status).toBe(200);
  expect(bank.editClue).toHaveBeenCalledWith(CID, "Remains of a ruined ship", WHO);
  // The repo returns an approved clue to pending; the route must not undo that.
  expect(bank.setClueApproval).not.toHaveBeenCalled();
});

it("applies an edit before a decision in the same body, so the decision lands on the edited clue", async () => {
  await patch({ approval: "approved", familyFriendly: true, text: "Ruined vessel" });
  expect(order[0]).toBe("edit");
  expect(order).toEqual(expect.arrayContaining(["approval:approved", "ff:true"]));
});

it("never takes who decided from the body", async () => {
  await patch({ approval: "approved", by: "mallory" });
  expect(bank.setClueApproval).toHaveBeenCalledWith(CID, "approved", WHO);
});

it("refuses an empty or malformed body", async () => {
  expect((await patch({})).status).toBe(400);
  expect((await patch({ text: "   " })).status).toBe(400);
  expect((await patch({ text: 5 })).status).toBe(400);
  expect((await patch({ approval: "ok" })).status).toBe(400);
  expect((await patch({ familyFriendly: "no" })).status).toBe(400);
  expect(order).toEqual([]);
});

it("404s for an unknown clue", async () => {
  bank.setClueApproval.mockResolvedValue(false);
  expect((await patch({ approval: "approved" })).status).toBe(404);
  bank.editClue.mockResolvedValue(false);
  expect((await patch({ text: "x y z" })).status).toBe(404);
});

it("never touches the word's own decisions", async () => {
  await patch({ approval: "approved", familyFriendly: true });
  expect(bank.setWordApproval).not.toHaveBeenCalled();
  expect(bank.setWordFamilyFriendly).not.toHaveBeenCalled();
});

/** @jest-environment node */

/** PATCH /api/crossword/clues/:id — admin-only; approve, reject, tag and edit a clue. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const bank = { editClue: jest.fn(), setClueApproval: jest.fn(), setClueFamilyFriendly: jest.fn() };
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ crosswordBank: bank }) }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { PATCH } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), ctx("c1"));

beforeEach(() => {
  jest.resetAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ sub: "u1", email: "", role: "admin" });
  bank.editClue.mockResolvedValue(true);
  bank.setClueApproval.mockResolvedValue(true);
  bank.setClueFamilyFriendly.mockResolvedValue(true);
});

it("401s for non-admins without touching the bank", async () => {
  (requireAdmin as jest.Mock).mockResolvedValue(null);
  expect((await patch({ approval: "approved" })).status).toBe(401);
  expect(bank.setClueApproval).not.toHaveBeenCalled();
});

it("approves and tags, recording the session's identity (sub when there is no email)", async () => {
  const res = await patch({ approval: "approved", familyFriendly: true });
  expect(res.status).toBe(200);
  expect(bank.setClueApproval).toHaveBeenCalledWith("c1", "approved", "u1");
  expect(bank.setClueFamilyFriendly).toHaveBeenCalledWith("c1", true, "u1");
});

it("edits the text first, so a decision in the same body lands on the edited clue", async () => {
  const order: string[] = [];
  bank.editClue.mockImplementation(async () => (order.push("edit"), true));
  bank.setClueApproval.mockImplementation(async () => (order.push("approve"), true));
  await patch({ text: "Ship's sad remains", approval: "approved" });
  expect(bank.editClue).toHaveBeenCalledWith("c1", "Ship's sad remains", "u1");
  expect(order).toEqual(["edit", "approve"]);
});

it("rejects empty or malformed bodies", async () => {
  expect((await patch({})).status).toBe(400);
  expect((await patch({ text: "   " })).status).toBe(400);
  expect((await patch({ approval: "x" })).status).toBe(400);
  expect((await patch({ familyFriendly: 1 })).status).toBe(400);
});

it("404s an unknown clue", async () => {
  bank.setClueApproval.mockResolvedValue(false);
  expect((await patch({ approval: "rejected" })).status).toBe(404);
});

/** @jest-environment node */

/** PATCH /api/crossword/clues/:id — admin-only; approve, reject, tag and edit a clue. */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const bank = { getClue: jest.fn(), editClue: jest.fn(), setClueApproval: jest.fn(), setClueFamilyFriendly: jest.fn() };
// The db facade's cascading decisions (§7.4), passed through to the bank fakes.
const cascade = (f: (...a: never[]) => unknown) => async (...a: unknown[]) => ({
  ok: !!(await (f as (...x: unknown[]) => unknown)(...a)),
  rejected: changed.rejected,
  untagged: changed.untagged,
});
/** What the facade reports it did to built puzzles. */
const changed: { rejected: string[]; untagged: string[] } = { rejected: [], untagged: [] };
const facade = () => ({
  setCrosswordClueApproval: cascade(bank.setClueApproval),
  setCrosswordClueFamilyFriendly: cascade(bank.setClueFamilyFriendly),
  editCrosswordClue: cascade(bank.editClue),
});
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => ({ crosswordBank: bank, ...facade() }) }));

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
  bank.getClue.mockResolvedValue({ id: "c1", wordId: "w1", answer: "WRECK", text: "Remains of a ruined ship" });
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

const patchFor = (body: unknown, wordId = "w1") =>
  PATCH(new Request("http://x", { method: "PATCH", headers: { "x-word-id": wordId }, body: JSON.stringify(body) }), ctx("c1"));
const clue = (text: string) => ({ id: "c1", wordId: "w1", answer: "WRECK", text });

it("409s approving a clue that can't air, with the problem, and writes nothing", async () => {
  bank.getClue.mockResolvedValue(clue("Ruin (4)"));
  const res = await patch({ approval: "approved" });
  expect(res.status).toBe(409);
  expect((await res.json()).problem).toBe("short");
  expect(bank.getClue).toHaveBeenCalledWith("c1");
  expect(bank.setClueApproval).not.toHaveBeenCalled();
});

it("409s a clue that gives the answer away, and checks the new text of an edit", async () => {
  bank.getClue.mockResolvedValue(clue("Remains of a ruined ship"));
  expect((await patch({ text: "Wrecked ship remains", approval: "approved" })).status).toBe(409);
  expect(bank.editClue).not.toHaveBeenCalled();
});

it("checks on every approval, with or without the old X-Word-Id header, and 404s an unknown clue", async () => {
  bank.getClue.mockResolvedValue(clue("Remains of a ruined ship"));
  expect((await patch({ approval: "approved" })).status).toBe(200);
  expect((await patchFor({ approval: "approved" }, "some-other-word")).status).toBe(200);
  expect(bank.setClueApproval).toHaveBeenCalledTimes(2);
  bank.getClue.mockResolvedValue(clue("Ruin (4)"));
  expect((await patchFor({ approval: "approved" })).status).toBe(409);
  bank.getClue.mockResolvedValue(null);
  expect((await patch({ approval: "approved" })).status).toBe(404);
  // Rejecting, tagging and editing need no check.
  bank.getClue.mockClear();
  await patch({ approval: "rejected", familyFriendly: false, text: "Anything at all" });
  expect(bank.getClue).not.toHaveBeenCalled();
});

it("goes through the db facade and reports the puzzles a decision changed", async () => {
  changed.rejected = ["p1"];
  changed.untagged = ["p1", "p2"];
  try {
    const res = await patch({ text: "Ruined vessel", familyFriendly: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, rejected: ["p1"], untagged: ["p1", "p2"] });
  } finally {
    changed.rejected = [];
    changed.untagged = [];
  }
});

it("stores an edit as the cleaned text the approval check validated", async () => {
  bank.getClue.mockResolvedValue(clue("Old text"));
  expect((await patch({ text: "  Remains of a ruined ship (5) ", approval: "approved" })).status).toBe(200);
  expect(bank.editClue).toHaveBeenCalledWith("c1", "Remains of a ruined ship", "u1");
});

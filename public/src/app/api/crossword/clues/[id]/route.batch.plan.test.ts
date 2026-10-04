/** @jest-environment node */

/**
 * PATCH /api/crossword/clues/:id against docs/crossword-mode-plan.md §7.3
 * step 4, §7.4 and §8.4, written from the plan and the batch's intent:
 *
 *  - approving a clue always runs validateClue on the server, against the
 *    answer of the clue's own word as the server reads it (getClue), whatever
 *    the client sends;
 *  - rejecting a clue, returning it to pending or editing it reaches built
 *    puzzles (the db facade's cascade), and the route says which it changed.
 */
jest.mock("../../../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../../../lib/require-admin", () => ({ requireAdmin: jest.fn() }));

const cascade = (o: { ok?: boolean; rejected?: string[]; untagged?: string[] } = {}) => ({ ok: true, rejected: [], untagged: [], ...o });
const mockDb = {
  crosswordBank: {
    getClue: jest.fn(),
    // Direct repo writes would skip the cascade; the route must not use them.
    setClueApproval: jest.fn(async () => true),
    setClueFamilyFriendly: jest.fn(async () => true),
    editClue: jest.fn(async () => true),
  },
  setCrosswordClueApproval: jest.fn(),
  setCrosswordClueFamilyFriendly: jest.fn(),
  editCrosswordClue: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: async () => mockDb }));

import { requireAdmin } from "../../../../../lib/require-admin";
import { PATCH } from "./route";

const CLUE = "64b0000000000000000000c1";
const patch = async (body: unknown, headers: Record<string, string> = {}) => {
  const res = await PATCH(
    new Request(`http://x/api/crossword/clues/${CLUE}`, { method: "PATCH", body: JSON.stringify(body), headers }),
    { params: Promise.resolve({ id: CLUE }) },
  );
  return { status: res.status, body: await res.json() };
};
const stored = (text: string, answer = "ORBIT") => ({
  id: CLUE,
  wordId: "64b0000000000000000000a1",
  answer,
  text,
  approval: { status: "pending" },
  familyFriendly: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  (requireAdmin as jest.Mock).mockResolvedValue({ email: "op@example.com", sub: "op" });
  mockDb.crosswordBank.getClue.mockResolvedValue(stored("Path round a star"));
  mockDb.setCrosswordClueApproval.mockResolvedValue(cascade());
  mockDb.setCrosswordClueFamilyFriendly.mockResolvedValue(cascade());
  mockDb.editCrosswordClue.mockResolvedValue(cascade());
});

describe("approval runs validateClue on the server", () => {
  it("a clean clue is approved, by the session's admin", async () => {
    const r = await patch({ approval: "approved" });
    expect(r.status).toBe(200);
    expect(mockDb.crosswordBank.getClue).toHaveBeenCalledWith(CLUE);
    expect(mockDb.setCrosswordClueApproval).toHaveBeenCalledWith(CLUE, "approved", "op@example.com");
  });

  it("a stored clue that leaks its answer is refused, whatever the client says about it", async () => {
    mockDb.crosswordBank.getClue.mockResolvedValue(stored("An orbit round a star"));
    const r = await patch({ approval: "approved", problem: null, valid: true, validated: true, answer: "ZZZZZ" });
    expect(r.status).toBe(409);
    expect(r.body.problem).toBe("leak");
    expect(mockDb.setCrosswordClueApproval).not.toHaveBeenCalled();
    expect(mockDb.crosswordBank.setClueApproval).not.toHaveBeenCalled();
  });

  it("the answer is the clue's own word on the server, not a word the client names", async () => {
    mockDb.crosswordBank.getClue.mockResolvedValue(stored("An orbit round a star"));
    const r = await patch({ approval: "approved" }, { "X-Word-Id": "64b0000000000000000000ff" });
    expect(r.status).toBe(409);
  });

  it("too short and too long are refused", async () => {
    mockDb.crosswordBank.getClue.mockResolvedValue(stored("Path"));
    expect((await patch({ approval: "approved" })).body.problem).toBe("short");
    mockDb.crosswordBank.getClue.mockResolvedValue(stored("A path taken by one body round another, such as a planet round its star"));
    expect((await patch({ approval: "approved" })).body.problem).toBe("long");
    expect(mockDb.setCrosswordClueApproval).not.toHaveBeenCalled();
  });

  it("the check runs on the cleaned text: a trailing length marker is not counted", async () => {
    mockDb.crosswordBank.getClue.mockResolvedValue(stored("Path round a star (5)"));
    expect((await patch({ approval: "approved" })).status).toBe(200);
  });

  it("an edit and an approval in one body: the edited text is checked", async () => {
    // The stored text is fine; the new one leaks.
    let r = await patch({ text: "Orbit, as of a moon", approval: "approved" });
    expect(r.status).toBe(409);
    expect(mockDb.editCrosswordClue).not.toHaveBeenCalled();
    expect(mockDb.setCrosswordClueApproval).not.toHaveBeenCalled();
    // The stored text leaks; the new one is fine.
    mockDb.crosswordBank.getClue.mockResolvedValue(stored("An orbit round a star"));
    r = await patch({ text: "Path round a star", approval: "approved" });
    expect(r.status).toBe(200);
    expect(mockDb.setCrosswordClueApproval).toHaveBeenCalledWith(CLUE, "approved", "op@example.com");
  });

  it("an unknown clue is 404 and nothing is written", async () => {
    mockDb.crosswordBank.getClue.mockResolvedValue(null);
    expect((await patch({ approval: "approved" })).status).toBe(404);
    expect(mockDb.setCrosswordClueApproval).not.toHaveBeenCalled();
  });

  it("rejecting or returning to pending needs no check", async () => {
    mockDb.crosswordBank.getClue.mockResolvedValue(stored("An orbit round a star"));
    expect((await patch({ approval: "rejected" })).status).toBe(200);
    expect((await patch({ approval: "pending" })).status).toBe(200);
  });

  it("a non-admin is refused before anything is read", async () => {
    (requireAdmin as jest.Mock).mockResolvedValue(null);
    expect((await patch({ approval: "approved" })).status).toBe(401);
    expect(mockDb.crosswordBank.getClue).not.toHaveBeenCalled();
  });
});

describe("decisions reach built puzzles", () => {
  it("a rejection goes through the cascade and reports the puzzles it took out of play", async () => {
    mockDb.setCrosswordClueApproval.mockResolvedValue(cascade({ rejected: ["p1", "p2"] }));
    const r = await patch({ approval: "rejected" });
    expect(r.status).toBe(200);
    expect(mockDb.setCrosswordClueApproval).toHaveBeenCalledWith(CLUE, "rejected", "op@example.com");
    expect([...r.body.rejected].sort()).toEqual(["p1", "p2"]);
    expect(mockDb.crosswordBank.setClueApproval).not.toHaveBeenCalled();
  });

  it("an edit goes through the cascade", async () => {
    mockDb.editCrosswordClue.mockResolvedValue(cascade({ rejected: ["p3"], untagged: ["p3"] }));
    const r = await patch({ text: "A brand new clue" });
    expect(r.status).toBe(200);
    expect(mockDb.editCrosswordClue).toHaveBeenCalledWith(CLUE, "A brand new clue", "op@example.com");
    expect(r.body).toMatchObject({ rejected: ["p3"], untagged: ["p3"] });
    expect(mockDb.crosswordBank.editClue).not.toHaveBeenCalled();
  });

  it("taking the tag off goes through the cascade", async () => {
    mockDb.setCrosswordClueFamilyFriendly.mockResolvedValue(cascade({ untagged: ["p4"] }));
    const r = await patch({ familyFriendly: false });
    expect(mockDb.setCrosswordClueFamilyFriendly).toHaveBeenCalledWith(CLUE, false, "op@example.com");
    expect(r.body.untagged).toEqual(["p4"]);
    expect(mockDb.crosswordBank.setClueFamilyFriendly).not.toHaveBeenCalled();
  });

  it("an unknown clue on a reject is 404", async () => {
    mockDb.setCrosswordClueApproval.mockResolvedValue(cascade({ ok: false }));
    expect((await patch({ approval: "rejected" })).status).toBe(404);
  });
});

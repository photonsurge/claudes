jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogWarn: jest.fn(), blogErr: jest.fn() }));
jest.mock("../lib/openrouter", () => ({ callOpenRouter: jest.fn() }));
import { UnrecoverableError } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { callOpenRouter } from "../lib/openrouter";
import { DEFAULT_SUGGEST_MODEL, suggest, suggestModel, suggestWords, SUGGEST_BATCH } from "./suggest";

const call = callOpenRouter as jest.Mock;
const job = (data: unknown) => ({ id: "1", data: { domain: "crossword", type: "crossword", event: "suggest", data } }) as any;
const reply = (words: unknown[]) => ({ status: "ok", content: JSON.stringify({ words }), latencyMs: 1 });

const word = (id: string, w: string) => ({
  id,
  word: w,
  definitions: [`a ${w.toLowerCase()} thing`],
  senses: [{ pos: "noun", definitions: ["another sense"] }],
  clues: [
    { id: `${id}c1`, text: "A stored clue (5)", approval: { status: "pending" } },
    { id: `${id}c2`, text: "Rejected clue", approval: { status: "rejected" } },
  ],
});

/** A fake bank that records every write, so "only the suggestion changed" is checkable. */
function fakeBank(words: Record<string, any>) {
  const writes: Array<[string, any]> = [];
  const bank = {
    getWordById: jest.fn(async (id: string) => words[id] ?? null),
    setWordSuggestion: jest.fn(async (id: string, s: any) => void writes.push([id, s])),
    // Anything that would change a decision: must never be called.
    setWordApproval: jest.fn(),
    setWordFamilyFriendly: jest.fn(),
    setClueApproval: jest.fn(),
    setClueFamilyFriendly: jest.fn(),
    editClue: jest.fn(),
    addClues: jest.fn(),
  };
  return { bank, writes };
}
const untouched = (b: ReturnType<typeof fakeBank>["bank"]) => {
  for (const k of ["setWordApproval", "setWordFamilyFriendly", "setClueApproval", "setClueFamilyFriendly", "editClue", "addClues"] as const) expect(b[k]).not.toHaveBeenCalled();
};

const OLD = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD, OPENROUTER_API_KEY: "k", CROSSWORD_MODEL: "test/model-a" };
  delete process.env.OPENROUTER_MODEL;
});
afterAll(() => {
  process.env = OLD;
});

describe("suggestWords", () => {
  it("stores a good reply as a suggestion and touches nothing else", async () => {
    const { bank, writes } = fakeBank({ w1: word("w1", "HARBOR") });
    call.mockResolvedValue(reply([{ word: "HARBOR", clue: "Safe place for ships", familyFriendly: true, reason: "plain noun" }]));
    const out = await suggestWords(bank, ["w1"]);
    expect(out).toMatchObject({ requested: 1, stored: 1, clueDropped: 0, skipped: [], failed: [] });
    expect(writes).toEqual([["w1", { clue: "Safe place for ships", familyFriendly: true, reason: "plain noun", model: "test/model-a", at: expect.any(Number) }]]);
    untouched(bank);
  });

  it("sends the definitions, senses and cleaned non-rejected clues, with the configured model", async () => {
    const { bank } = fakeBank({ w1: word("w1", "HARBOR") });
    call.mockResolvedValue(reply([{ word: "HARBOR", clue: "Safe place for ships", familyFriendly: true, reason: "" }]));
    await suggestWords(bank, ["w1"]);
    const arg = call.mock.calls[0][0];
    expect(arg.model).toBe("test/model-a");
    expect(arg.responseFormat).toBe("json_object");
    const sent = JSON.parse(arg.user).words[0];
    expect(sent).toEqual({ word: "HARBOR", definitions: ["a harbor thing", "another sense"], candidateClues: ["A stored clue"] });
  });

  it("falls back to OPENROUTER_MODEL", async () => {
    delete process.env.CROSSWORD_MODEL;
    process.env.OPENROUTER_MODEL = "test/model-b";
    const { bank } = fakeBank({ w1: word("w1", "HARBOR") });
    call.mockResolvedValue(reply([{ word: "HARBOR", clue: "Safe place for ships", familyFriendly: true, reason: "" }]));
    await suggestWords(bank, ["w1"]);
    expect(call.mock.calls[0][0].model).toBe("test/model-b");
  });

  it("batches words into calls of SUGGEST_BATCH", async () => {
    const words: Record<string, any> = {};
    const ids: string[] = [];
    for (let i = 0; i < SUGGEST_BATCH + 1; i++) {
      const w = "WORD" + String.fromCharCode(65 + i).repeat(2);
      words["i" + i] = word("i" + i, w);
      ids.push("i" + i);
    }
    call.mockImplementation(async (o: any) =>
      reply(JSON.parse(o.user).words.map((w: any) => ({ word: w.word, clue: "A perfectly fine clue", familyFriendly: false, reason: "r" }))),
    );
    const { bank } = fakeBank(words);
    const out = await suggestWords(bank, ids);
    expect(call).toHaveBeenCalledTimes(2);
    expect(out.stored).toBe(SUGGEST_BATCH + 1);
  });

  it("fails a batch on bad JSON: nothing stored, the ids reported", async () => {
    const { bank, writes } = fakeBank({ w1: word("w1", "HARBOR") });
    call.mockResolvedValue({ status: "ok", content: "not json {", latencyMs: 1 });
    const out = await suggestWords(bank, ["w1"]);
    expect(out).toMatchObject({ stored: 0, failed: ["w1"] });
    expect(writes).toEqual([]);
  });

  it("fails a batch when the model call errors", async () => {
    const { bank } = fakeBank({ w1: word("w1", "HARBOR") });
    call.mockResolvedValue({ status: "error", content: "", error: "502", latencyMs: 1 });
    expect((await suggestWords(bank, ["w1"])).failed).toEqual(["w1"]);
  });

  it("drops a leaking clue but keeps the family-friendly suggestion", async () => {
    const { bank, writes } = fakeBank({ w1: word("w1", "HARBOR") });
    call.mockResolvedValue(reply([{ word: "HARBOR", clue: "A harbor for boats", familyFriendly: true, reason: "ok" }]));
    const out = await suggestWords(bank, ["w1"]);
    expect(out).toMatchObject({ stored: 1, clueDropped: 1 });
    expect(writes[0][1]).toMatchObject({ clue: "", familyFriendly: true, reason: "ok" });
  });

  it("drops a clue over 48 characters", async () => {
    const { bank, writes } = fakeBank({ w1: word("w1", "HARBOR") });
    call.mockResolvedValue(reply([{ word: "HARBOR", clue: "x".repeat(49), familyFriendly: false, reason: "r" }]));
    const out = await suggestWords(bank, ["w1"]);
    expect(out.clueDropped).toBe(1);
    expect(writes[0][1]).toMatchObject({ clue: "", familyFriendly: false });
  });

  it("skips a word the reply leaves out, and stores the rest", async () => {
    const { bank, writes } = fakeBank({ w1: word("w1", "HARBOR"), w2: word("w2", "MEADOW") });
    call.mockResolvedValue(reply([{ word: "MEADOW", clue: "Grassy field", familyFriendly: true, reason: "" }]));
    const out = await suggestWords(bank, ["w1", "w2"]);
    expect(out).toMatchObject({ stored: 1, skipped: ["w1"] });
    expect(writes.map((w) => w[0])).toEqual(["w2"]);
  });

  it("skips unknown words and words with nothing to go on, without calling the model", async () => {
    const empty = { ...word("w2", "EMPTY"), definitions: [], senses: [], clues: [] };
    const { bank } = fakeBank({ w2: empty });
    const out = await suggestWords(bank, ["nope", "w2"]);
    expect(out).toMatchObject({ stored: 0, skipped: ["nope", "w2"] });
    expect(call).not.toHaveBeenCalled();
  });

  it("fails clearly with no key, before any call", async () => {
    const { bank } = fakeBank({ w1: word("w1", "HARBOR") });
    delete process.env.OPENROUTER_API_KEY;
    await expect(suggestWords(bank, ["w1"])).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(call).not.toHaveBeenCalled();
  });

  it("falls back to the default model with neither variable set", () => {
    delete process.env.CROSSWORD_MODEL;
    delete process.env.OPENROUTER_MODEL;
    expect(suggestModel()).toBe(DEFAULT_SUGGEST_MODEL);
  });
});

describe("crossword.suggest handler", () => {
  it("runs the batch against the bank", async () => {
    const { bank, writes } = fakeBank({ w1: word("w1", "HARBOR") });
    (getAppDb as jest.Mock).mockResolvedValue({ crosswordBank: bank });
    call.mockResolvedValue(reply([{ word: "HARBOR", clue: "Safe place for ships", familyFriendly: true, reason: "" }]));
    const out = await suggest(job({ wordIds: ["w1"] }));
    expect(out.stored).toBe(1);
    expect(writes).toHaveLength(1);
    untouched(bank);
  });

  it("is unrecoverable with no ids or no key", async () => {
    (getAppDb as jest.Mock).mockResolvedValue({ crosswordBank: fakeBank({}).bank });
    await expect(suggest(job({}))).rejects.toBeInstanceOf(UnrecoverableError);
    delete process.env.OPENROUTER_API_KEY;
    await expect(suggest(job({ wordIds: ["w1"] }))).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});

/**
 * `crossword.suggest`, from the plan (§7.4 "Suggestions make it quicker, and are
 * never approvals", §8.3 Suggest, §12 worker): operator-triggered only (no
 * schedule registers it); per word the definitions go to the model as the facts
 * and one polished clue of at most 48 characters for the most common sense, not
 * containing the answer, comes back with a family-friendly suggestion and a
 * one-line reason; a leaking or over-long clue is dropped; bad JSON fails that
 * batch only; nothing ever changes an approval, a family-friendly tag or a
 * clue's text; the model comes from CROSSWORD_MODEL then OPENROUTER_MODEL and
 * falls back to the app's usual OpenRouter default; no key fails clearly.
 *
 * OpenRouter is mocked at the HTTP boundary (global fetch), so the reply is the
 * provider's own shape.
 */
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn() }));
jest.mock("../blog", () => ({ blogInfo: jest.fn(), blogWarn: jest.fn(), blogErr: jest.fn() }));
import fs from "fs";
import path from "path";
import { UnrecoverableError } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { CLUE_MAX } from "@photonsurge/shared/crossword";
import * as jobs from "../jobs/crossword";
import { DEFAULT_SUGGEST_MODEL, suggest, suggestWords, SUGGEST_BATCH } from "./suggest";

type Sent = { url: string; auth: string | null; body: any };
let sent: Sent[];
/** Per call: the model's message content, or a function of the request body. */
let replies: Array<string | ((body: any) => string)>;

const okResponse = (content: string) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ model: "x", choices: [{ message: { content } }], usage: {} }),
    text: async () => "",
  }) as unknown as Response;

const installFetch = () => {
  global.fetch = jest.fn(async (url: any, init?: any) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    sent.push({ url: String(url), auth: init?.headers?.Authorization ?? null, body });
    const r = replies.shift();
    const content = typeof r === "function" ? r(body) : r ?? "";
    return okResponse(content);
  }) as unknown as typeof fetch;
};

const userOf = (s: Sent) => s.body.messages.find((m: any) => m.role === "user").content as string;
const systemOf = (s: Sent) => s.body.messages.find((m: any) => m.role === "system").content as string;
const json = (words: unknown[]) => JSON.stringify({ words });

/** A bank word, already approved with an approved, tagged clue, so a change would show. */
const bankWord = (id: string, w: string, defs: string[]) => ({
  id,
  word: w.toLowerCase(),
  length: w.length,
  pos: ["noun"],
  categories: [],
  flags: {},
  warnings: [],
  approval: { status: "approved", by: "op@example.com", at: 111 },
  familyFriendly: true,
  clueCount: 2,
  senses: [],
  definitions: defs,
  clues: [
    { id: `${id}-c1`, text: "Place of shelter for boats (6)", approval: { status: "approved", by: "op@example.com", at: 112 }, familyFriendly: true },
    { id: `${id}-c2`, text: "Port", approval: { status: "pending" }, familyFriendly: null },
  ],
  raw: {},
});

/**
 * A bank that answers reads and records every call. Only getWordById and
 * setWordSuggestion are allowed; any other method (approval, tags, clue
 * edits, adding clues…) is recorded as a forbidden call.
 */
function makeBank(words: Record<string, any>) {
  const suggestions: Array<[string, any]> = [];
  const forbidden: string[] = [];
  const base = {
    getWordById: async (id: string) => words[id] ?? null,
    setWordSuggestion: async (id: string, s: any) => {
      suggestions.push([id, s]);
      return true;
    },
  };
  const bank = new Proxy(base as any, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      return (..._args: unknown[]) => {
        forbidden.push(String(prop));
        return Promise.resolve(true);
      };
    },
  });
  return { bank, suggestions, forbidden };
}

const HARBOR_DEFS = ["A sheltered area of water where ships can anchor safely.", "A refuge; a place of safety."];

const OLD = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  sent = [];
  replies = [];
  installFetch();
  process.env = { ...OLD, OPENROUTER_API_KEY: "test-key", CROSSWORD_MODEL: "vendor/crossword-model" };
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_BASE_URL;
});
afterAll(() => {
  process.env = OLD;
});

describe("operator-triggered only", () => {
  it("is a registered job handler", () => {
    expect(typeof (jobs as any).suggest).toBe("function");
  });

  it("no schedule registers it: worker/src/index.ts has no repeatable (or any enqueue) for suggest", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "index.ts"), "utf8");
    expect(src).not.toMatch(/event:\s*["'`]suggest["'`]/);
    expect(src).not.toMatch(/crossword-suggest/);
    expect(src).not.toMatch(/\bsuggest\b/i);
  });

  it("the job module itself schedules nothing", () => {
    const src = fs.readFileSync(path.join(__dirname, "suggest.ts"), "utf8");
    expect(src).not.toMatch(/\brepeat\s*:/);
    expect(src).not.toMatch(/upsertJobScheduler|setInterval|cron/i);
  });
});

describe("a good reply", () => {
  it("sends each word's definitions as the facts, and stores one polished clue with a family-friendly suggestion and reason", async () => {
    const { bank, suggestions, forbidden } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    replies = [json([{ word: "HARBOR", clue: "Safe haven for ships", familyFriendly: true, reason: "An everyday word with no adult sense." }])];

    await suggestWords(bank, ["w1"]);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/\/chat\/completions$/);
    expect(sent[0].auth).toBe("Bearer test-key");
    const user = userOf(sent[0]);
    for (const d of HARBOR_DEFS) expect(user).toContain(d);
    expect(user.toUpperCase()).toContain("HARBOR");
    // The instructions carry the plan's rules: ≤48, most common sense, no answer, family-friendly with a reason.
    const sys = systemOf(sent[0]);
    expect(sys).toContain(String(CLUE_MAX));
    expect(sys).toMatch(/most common sense/i);
    expect(sys).toMatch(/not contain the answer/i);
    expect(sys).toMatch(/family.?friendly/i);
    expect(sys).toMatch(/reason/i);

    expect(suggestions).toHaveLength(1);
    const [id, s] = suggestions[0];
    expect(id).toBe("w1");
    expect(s).toMatchObject({ clue: "Safe haven for ships", familyFriendly: true, reason: "An everyday word with no adult sense." });
    expect(s.clue.length).toBeLessThanOrEqual(CLUE_MAX);
    expect(forbidden).toEqual([]);
  });

  it("keeps a clue of exactly 48 characters", async () => {
    const clue = "Where ships shelter from storms on a rough coast".slice(0, CLUE_MAX);
    expect(clue).toHaveLength(CLUE_MAX);
    const { bank, suggestions } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    replies = [json([{ word: "HARBOR", clue, familyFriendly: true, reason: "fine" }])];
    await suggestWords(bank, ["w1"]);
    expect(suggestions[0][1].clue).toBe(clue);
  });

  it("stores one suggestion per word in the batch", async () => {
    const { bank, suggestions } = makeBank({
      w1: bankWord("w1", "HARBOR", HARBOR_DEFS),
      w2: bankWord("w2", "MEADOW", ["A field of grass."]),
    });
    replies = [
      json([
        { word: "HARBOR", clue: "Safe haven for ships", familyFriendly: true, reason: "plain" },
        { word: "MEADOW", clue: "Grassy field for grazing", familyFriendly: true, reason: "plain" },
      ]),
    ];
    await suggestWords(bank, ["w1", "w2"]);
    expect(suggestions.map(([id]) => id).sort()).toEqual(["w1", "w2"]);
    expect(suggestions.every(([, s]) => typeof s.reason === "string" && typeof s.familyFriendly === "boolean")).toBe(true);
  });

  it("stores a 'not family friendly' suggestion as a suggestion only, never as the tag", async () => {
    const { bank, suggestions, forbidden } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    replies = [json([{ word: "HARBOR", clue: "Safe haven for ships", familyFriendly: false, reason: "test reason" }])];
    await suggestWords(bank, ["w1"]);
    expect(suggestions[0][1]).toMatchObject({ familyFriendly: false, reason: "test reason" });
    expect(forbidden).toEqual([]);
  });
});

describe("a clue that cannot air is dropped", () => {
  const cases: Array<[string, string]> = [
    ["the answer verbatim", "A harbor for small boats"],
    ["the answer in another case and form", "Ships are HARBORED here"],
    ["over 48 characters", "A sheltered stretch of water where ships can anchor"],
  ];
  it.each(cases)("drops a clue with %s", async (_what, clue) => {
    const { bank, suggestions, forbidden } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    replies = [json([{ word: "HARBOR", clue, familyFriendly: true, reason: "fine" }])];
    await suggestWords(bank, ["w1"]);
    // Whatever is stored, it is not that clue.
    for (const [, s] of suggestions) expect(s?.clue ?? "").not.toBe(clue);
    expect(JSON.stringify(suggestions)).not.toContain(clue);
    expect(forbidden).toEqual([]);
  });

  it("dropping one word's clue does not drop the other words in the batch", async () => {
    const { bank, suggestions } = makeBank({
      w1: bankWord("w1", "HARBOR", HARBOR_DEFS),
      w2: bankWord("w2", "MEADOW", ["A field of grass."]),
    });
    replies = [
      json([
        { word: "HARBOR", clue: "A harbor for small boats", familyFriendly: true, reason: "r" },
        { word: "MEADOW", clue: "Grassy field for grazing", familyFriendly: true, reason: "r" },
      ]),
    ];
    await suggestWords(bank, ["w1", "w2"]);
    expect(suggestions.find(([id]) => id === "w2")?.[1].clue).toBe("Grassy field for grazing");
  });
});

describe("bad JSON fails that batch only", () => {
  it("stores nothing for a batch whose reply is not JSON", async () => {
    const { bank, suggestions } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    replies = ["Sure! Here are your clues: HARBOR — Safe haven for ships"];
    const out = await suggestWords(bank, ["w1"]);
    expect(suggestions).toEqual([]);
    expect(out.failed).toEqual(["w1"]);
  });

  it("the other batches in the same request are still stored", async () => {
    const words: Record<string, any> = {};
    const ids: string[] = [];
    const names = Array.from({ length: SUGGEST_BATCH + 2 }, (_, i) => "WORD" + "ABCDEFGHIJKLMNOP"[i].repeat(3));
    names.forEach((n, i) => {
      words["i" + i] = bankWord("i" + i, n, [`Definition of ${n.toLowerCase()}.`]);
      ids.push("i" + i);
    });
    replies = [
      "{ not json",
      (body) =>
        json(
          JSON.parse(body.messages.find((m: any) => m.role === "user").content)
            .words.map((w: any) => ({ word: w.word, clue: "A perfectly fine clue", familyFriendly: true, reason: "r" })),
        ),
    ];
    const { bank, suggestions, forbidden } = makeBank(words);
    const out = await suggestWords(bank, ids);
    expect(sent).toHaveLength(2);
    // The first batch failed as a whole; the second was stored.
    const firstBatch = ids.slice(0, SUGGEST_BATCH);
    const secondBatch = ids.slice(SUGGEST_BATCH);
    expect(out.failed.sort()).toEqual([...firstBatch].sort());
    expect(suggestions.map(([id]) => id).sort()).toEqual([...secondBatch].sort());
    expect(forbidden).toEqual([]);
  });
});

describe("a suggestion never changes an approval", () => {
  it("calls nothing on the bank but the suggestion write, and leaves the word, its approval, tags and clue texts as they were", async () => {
    const w = bankWord("w1", "HARBOR", HARBOR_DEFS);
    const before = JSON.parse(JSON.stringify(w));
    const { bank, suggestions, forbidden } = makeBank({ w1: w });
    replies = [json([{ word: "HARBOR", clue: "Safe haven for ships", familyFriendly: false, reason: "r", approval: "approved", approve: true }])];
    await suggestWords(bank, ["w1"]);
    expect(forbidden).toEqual([]);
    expect(w).toEqual(before);
    // The stored suggestion carries no approval or tag field of its own.
    const s = suggestions[0][1];
    expect(Object.keys(s).sort()).toEqual(expect.arrayContaining(["clue", "familyFriendly", "reason"]));
    expect(s).not.toHaveProperty("approval");
    expect(s).not.toHaveProperty("approve");
    expect(s).not.toHaveProperty("status");
  });

  it("the job handler, run against the app's bank, writes only suggestions", async () => {
    const { bank, suggestions, forbidden } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    (getAppDb as jest.Mock).mockResolvedValue({ crosswordBank: bank });
    replies = [json([{ word: "HARBOR", clue: "Safe haven for ships", familyFriendly: true, reason: "r" }])];
    await suggest({ id: "j1", data: { domain: "crossword", type: "crossword", event: "suggest", data: { wordIds: ["w1"] } } } as any);
    expect(suggestions).toHaveLength(1);
    expect(forbidden).toEqual([]);
  });
});

describe("the model", () => {
  const run = async () => {
    const { bank, suggestions } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    replies = [json([{ word: "HARBOR", clue: "Safe haven for ships", familyFriendly: true, reason: "r" }])];
    await suggestWords(bank, ["w1"]);
    return suggestions;
  };

  it("uses CROSSWORD_MODEL first, even when OPENROUTER_MODEL is set", async () => {
    process.env.OPENROUTER_MODEL = "vendor/general-model";
    await run();
    expect(sent[0].body.model).toBe("vendor/crossword-model");
  });

  it("falls back to OPENROUTER_MODEL", async () => {
    delete process.env.CROSSWORD_MODEL;
    process.env.OPENROUTER_MODEL = "vendor/general-model";
    await run();
    expect(sent[0].body.model).toBe("vendor/general-model");
  });

  it("follows whatever the variable says", async () => {
    process.env.CROSSWORD_MODEL = "someone/anything-at-all";
    await run();
    expect(sent[0].body.model).toBe("someone/anything-at-all");
  });

  it("with neither variable set, uses the app's usual OpenRouter default", async () => {
    delete process.env.CROSSWORD_MODEL;
    delete process.env.OPENROUTER_MODEL;
    await run();
    expect(sent[0].body.model).toBe(DEFAULT_SUGGEST_MODEL);
  });
});

describe("no key", () => {
  it("fails clearly, before any call, storing nothing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { bank, suggestions } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    await expect(suggestWords(bank, ["w1"])).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(sent).toEqual([]);
    expect(suggestions).toEqual([]);
  });

  it("the job fails without retrying (a retry gives the same answer)", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { bank } = makeBank({ w1: bankWord("w1", "HARBOR", HARBOR_DEFS) });
    (getAppDb as jest.Mock).mockResolvedValue({ crosswordBank: bank });
    const p = suggest({ id: "j1", data: { domain: "crossword", type: "crossword", event: "suggest", data: { wordIds: ["w1"] } } } as any);
    await expect(p).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(p).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(sent).toEqual([]);
  });
});

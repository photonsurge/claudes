/**
 * Plan-written tests for the candidate pick (docs/crossword-mode-plan.md §7.3
 * step 1, §7.4, §12 worker): about 60 words from the approved pool — approved
 * word with an approved clue, 3–12 letters, at or above minZipf, not in the
 * channel's last 20 puzzles, both tagged on a family-friendly channel — with a
 * spread of lengths, seeded. The REAL bank repo runs over an in-memory
 * stand-in for its two collections (no Mongo).
 */
import { DEFAULT_CROSSWORD_CONFIG, type CrosswordConfig, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { makeCrosswordBankRepo } from "@photonsurge/shared/db/crossword-bank-repo";
import { PICK_COUNT, pickCandidates } from "./pick";

type Doc = Record<string, any>;

const getPath = (d: any, path: string) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), d);

function matchCond(v: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith("$"))) {
    return Object.entries(cond as Record<string, any>).every(([op, x]) => {
      switch (op) {
        case "$eq":
          return v === x;
        case "$ne":
          return v !== x;
        case "$in":
          return (x as unknown[]).includes(v);
        case "$nin":
          return !(x as unknown[]).includes(v);
        case "$gte":
          return typeof v === "number" && v >= x;
        case "$lte":
          return typeof v === "number" && v <= x;
        case "$gt":
          return typeof v === "number" && v > x;
        case "$lt":
          return typeof v === "number" && v < x;
        case "$exists":
          return (v !== undefined) === !!x;
        default:
          throw new Error(`fake collection: unsupported operator ${op}`);
      }
    });
  }
  return v === cond;
}

function matches(d: Doc, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === "$and") return (cond as any[]).every((f) => matches(d, f));
    if (k === "$or") return (cond as any[]).some((f) => matches(d, f));
    if (k.startsWith("$")) throw new Error(`fake collection: unsupported top-level ${k}`);
    return matchCond(getPath(d, k), cond);
  });
}

function fakeCollection(docs: Doc[]) {
  const indexes = new Map<string, string>([["_id_", JSON.stringify({ _id: 1 })]]);
  const cursor = (rows: Doc[]) => {
    let out = [...rows];
    const c: any = {
      sort: () => c,
      skip: (n: number) => ((out = out.slice(n)), c),
      limit: (n: number) => ((out = n ? out.slice(0, n) : out), c),
      project: () => c,
      toArray: async () => out.map((d) => structuredClone(d)),
    };
    return c;
  };
  return {
    docs,
    indexes,
    find: jest.fn((filter: Record<string, any> = {}) => cursor(docs.filter((d) => matches(d, filter)))),
    findOne: async (filter: Record<string, any>) => docs.find((d) => matches(d, filter)) ?? null,
    countDocuments: async (filter: Record<string, any> = {}) => docs.filter((d) => matches(d, filter)).length,
    estimatedDocumentCount: async () => docs.length,
    aggregate: () => ({
      toArray: async () => {
        throw new Error("fake collection: aggregate not supported");
      },
    }),
    createIndex: jest.fn(async (key: Record<string, number>, opts: { name: string }) => {
      const k = JSON.stringify(key);
      const had = indexes.get(opts.name);
      if (had !== undefined && had !== k) throw new Error(`index ${opts.name} exists with a different key`);
      indexes.set(opts.name, k);
      return opts.name;
    }),
    indexExists: async (name: string) => indexes.has(name),
    dropIndex: jest.fn(async (name: string) => {
      if (!indexes.has(name)) throw new Error(`index not found with name [${name}]`);
      indexes.delete(name);
    }),
  };
}

type Tag = boolean | null;
interface ClueSpec {
  id: string;
  text: string;
  status?: "pending" | "approved" | "rejected";
  ff?: Tag;
}
interface WordSpec {
  id: string;
  answer: string;
  status?: "pending" | "approved" | "rejected";
  ff?: Tag;
  zipf?: number;
  clues: ClueSpec[];
}

function bankDocs(specs: WordSpec[]) {
  const words: Doc[] = [];
  const clues: Doc[] = [];
  for (const w of specs) {
    words.push({
      _id: w.id,
      word: w.answer.toLowerCase(),
      norm: w.answer,
      length: w.answer.length,
      pos: "noun",
      flags: { adult: false, vulgar: false, offensive: false },
      enrichment: { status: "done" },
      validation: { decision: "accepted", sources: { wordfreq: { zipf: w.zipf ?? 5 } } },
      approval: { status: w.status ?? "approved", ...(w.status === "pending" ? {} : { by: "op", at: 1 }) },
      familyFriendly: w.ff === undefined ? true : w.ff,
    });
    for (const c of w.clues) {
      clues.push({
        _id: c.id,
        answerId: w.id,
        answerNorm: w.answer,
        clue: c.text,
        source: { name: "llm", ref: "x", createdBy: "pipeline" },
        approval: { status: c.status ?? "approved" },
        familyFriendly: c.ff === undefined ? true : c.ff,
      });
    }
  }
  return { words, clues };
}


const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** A distinct A–Z word of length n for index i. */
function word(n: number, i: number): string {
  let s = "";
  let x = i + 1;
  for (let k = 0; k < n; k++) {
    s += LETTERS[x % 26];
    x = Math.floor(x / 26) + k * 7 + 3;
  }
  return s;
}
let uid = 0;
function spec(answer: string, over: Partial<WordSpec> & { clueStatus?: ClueSpec["status"]; clueFf?: Tag } = {}): WordSpec {
  const { clueStatus, clueFf, ...w } = over;
  const id = `w${uid++}`;
  return {
    id,
    answer,
    ...w,
    clues: w.clues ?? [{ id: `${id}-c`, text: "A perfectly ordinary clue", ...(clueStatus ? { status: clueStatus } : {}), ...(clueFf !== undefined ? { ff: clueFf } : {}) }],
  };
}

function fakeDb(bank: WordSpec[], puzzles: CrosswordPuzzle[] = []) {
  const { words, clues } = bankDocs(bank);
  const wordsCol = fakeCollection(words);
  const cluesCol = fakeCollection(clues);
  const conn = { db: { collection: (name: string) => (name === "crosswordbankwords" ? wordsCol : cluesCol) } };
  const lastPlay = (p: CrosswordPuzzle, s: string) => Math.max(...p.plays.filter((x) => x.sceneId === s).map((x) => x.startedAt));
  return {
    crosswordBank: makeCrosswordBankRepo(conn as any),
    crosswordPuzzles: {
      recentForScene: jest.fn(async (sceneId: string, n: number) =>
        n <= 0
          ? []
          : puzzles
              .filter((p) => p.plays.some((x) => x.sceneId === sceneId))
              .sort((a, b) => lastPlay(b, sceneId) - lastPlay(a, sceneId))
              .slice(0, n),
      ),
    },
  } as any;
}

const played = (n: number, sceneId: string, startedAt: number, answers: string[]): CrosswordPuzzle => ({
  id: `p${sceneId}${n}`,
  title: "",
  width: 1,
  height: 1,
  entries: answers.map((answer, i) => ({ id: `${i + 1}A`, num: i + 1, dir: "across", row: 0, col: 0, answer, clue: "x", wordId: "", clueId: "" })),
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 0,
  plays: [{ sceneId, startedAt }],
});

const cfg = (over: Partial<CrosswordConfig> = {}) => ({ ...DEFAULT_CROSSWORD_CONFIG, ...over });
const answersOf = (r: { words: { answer: string }[] }) => new Set(r.words.map((w) => w.answer));

const ENV = "CROSSWORD_ALLOW_UNAPPROVED";
let envWas: string | undefined;
beforeEach(() => {
  envWas = process.env[ENV];
  delete process.env[ENV];
});
afterEach(() => {
  if (envWas === undefined) delete process.env[ENV];
  else process.env[ENV] = envWas;
});

describe("pickCandidates (§7.3 step 1)", () => {
  it("takes only approved words that have an approved clue", async () => {
    const ok = spec("ORBIT");
    const pendingWord = spec("PLANET", { status: "pending" });
    const rejectedWord = spec("COMET", { status: "rejected" });
    const pendingClueOnly = spec("GALAXY", { clueStatus: "pending" });
    const rejectedClueOnly = spec("NEBULA", { clueStatus: "rejected" });
    const r = await pickCandidates(fakeDb([ok, pendingWord, rejectedWord, pendingClueOnly, rejectedClueOnly]), "xw", cfg({ familyFriendlyOnly: false }), { seed: 1 });
    expect([...answersOf(r)]).toEqual(["ORBIT"]);
    expect(r.available).toBe(1);
    expect(r.words[0].wordId).toBe(ok.id);
    // Only its approved clues come with it.
    const mixed = spec("SATURN", {
      clues: [
        { id: "m-a", text: "Ringed planet" },
        { id: "m-p", text: "Sixth from the sun", status: "pending" },
        { id: "m-r", text: "Roman god of sowing", status: "rejected" },
      ],
    });
    const r2 = await pickCandidates(fakeDb([mixed]), "xw", cfg({ familyFriendlyOnly: false }), { seed: 1 });
    expect(r2.words[0].clues.map((c) => c.id)).toEqual(["m-a"]);
  });

  it("on a family-friendly channel the word and the clue must both be tagged; untagged counts as not", async () => {
    const both = spec("ORBIT");
    const wordNull = spec("PLANET", { ff: null });
    const wordFalse = spec("COMET", { ff: false });
    const clueNull = spec("GALAXY", { clueFf: null });
    const clueFalse = spec("NEBULA", { clueFf: false });
    const bank = [both, wordNull, wordFalse, clueNull, clueFalse];
    const on = await pickCandidates(fakeDb(bank), "xw", cfg({ familyFriendlyOnly: true }), { seed: 1 });
    expect([...answersOf(on)]).toEqual(["ORBIT"]);
    for (const w of on.words) for (const c of w.clues) expect(c.familyFriendly).toBe(true);
    // Off the switch, all five are playable.
    const off = await pickCandidates(fakeDb(bank), "xw", cfg({ familyFriendlyOnly: false }), { seed: 1 });
    expect(answersOf(off).size).toBe(5);
  });

  it("on a family-friendly channel, a word keeps only its tagged clues", async () => {
    const w = spec("SATURN", {
      clues: [
        { id: "t-1", text: "Ringed planet", ff: true },
        { id: "t-2", text: "Sixth from the sun", ff: null },
        { id: "t-3", text: "Roman god of sowing", ff: false },
      ],
    });
    const r = await pickCandidates(fakeDb([w]), "xw", cfg({ familyFriendlyOnly: true }), { seed: 1 });
    expect(r.words[0].clues.map((c) => c.id)).toEqual(["t-1"]);
  });

  it("honours minZipf: at or above it only", async () => {
    const bank = [spec("ORBIT", { zipf: 4 }), spec("PLANET", { zipf: 3.99 }), spec("COMET", { zipf: 6 })];
    const r = await pickCandidates(fakeDb(bank), "xw", cfg({ minZipf: 4, familyFriendlyOnly: false }), { seed: 1 });
    expect(answersOf(r)).toEqual(new Set(["ORBIT", "COMET"]));
  });

  it("3–12 letters only", async () => {
    const bank = [spec("AB"), spec("ABC"), spec("ABCDEFGHIJKL"), spec("ABCDEFGHIJKLM")];
    const r = await pickCandidates(fakeDb(bank), "xw", cfg({ maxSize: 21, familyFriendlyOnly: false }), { seed: 1 });
    expect(answersOf(r)).toEqual(new Set(["ABC", "ABCDEFGHIJKL"]));
  });

  it("leaves out the words of the channel's last 20 puzzles, and only those", async () => {
    const bank = Array.from({ length: 25 }, (_, i) => spec(word(6, i)));
    const ans = bank.map((w) => w.answer);
    // 21 puzzles on this channel, one word each: ans[0] is in the most recent, ans[20] in the 21st.
    const puzzles = Array.from({ length: 21 }, (_, n) => played(n, "xw", 1_000 - n, [ans[n]]));
    // Another channel played ans[21] just now.
    puzzles.push(played(99, "yy", 5_000, [ans[21]]));
    const r = await pickCandidates(fakeDb(bank, puzzles), "xw", cfg({ familyFriendlyOnly: false }), { seed: 1 });
    const got = answersOf(r);
    for (let n = 0; n < 20; n++) expect(got.has(ans[n])).toBe(false);
    expect(got.has(ans[20])).toBe(true); // the 21st puzzle back is outside the window
    expect(got.has(ans[21])).toBe(true); // another channel's play does not count
    expect(got.size).toBe(5);
  });

  it("takes about 60 when the pool is larger, with a spread of lengths", async () => {
    const bank: WordSpec[] = [];
    for (let n = 3; n <= 12; n++) for (let i = 0; i < 40; i++) bank.push(spec(word(n, i + n * 100)));
    const r = await pickCandidates(fakeDb(bank), "xw", cfg({ familyFriendlyOnly: false }), { seed: 4 });
    expect(PICK_COUNT).toBe(60);
    expect(r.words.length).toBe(60);
    expect(r.available).toBe(bank.length);
    const lengths = new Set(r.words.map((w) => w.answer.length));
    expect(lengths.size).toBeGreaterThanOrEqual(6);
  });

  it("is seeded: the same seed gives the same pick", async () => {
    const bank: WordSpec[] = [];
    for (let n = 3; n <= 12; n++) for (let i = 0; i < 20; i++) bank.push(spec(word(n, i + n * 50)));
    const a = await pickCandidates(fakeDb(bank), "xw", cfg({ familyFriendlyOnly: false }), { seed: 12 });
    const b = await pickCandidates(fakeDb([...bank].reverse()), "xw", cfg({ familyFriendlyOnly: false }), { seed: 12 });
    expect(b.words.map((w) => w.answer)).toEqual(a.words.map((w) => w.answer));
  });

  it("CROSSWORD_ALLOW_UNAPPROVED=true lets pending words in; off, they stay out", async () => {
    const bank = [spec("ORBIT"), spec("PLANET", { status: "pending", ff: null, clueStatus: "pending", clueFf: null })];
    const off = await pickCandidates(fakeDb(bank), "xw", cfg(), { seed: 1 });
    expect(answersOf(off)).toEqual(new Set(["ORBIT"]));
    process.env[ENV] = "true";
    const on = await pickCandidates(fakeDb(bank), "xw", cfg(), { seed: 1 });
    expect(answersOf(on)).toEqual(new Set(["ORBIT", "PLANET"]));
  });
});

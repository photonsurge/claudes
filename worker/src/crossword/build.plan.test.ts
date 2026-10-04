/**
 * Plan-written tests for the puzzle build, top-up and the bank index
 * (docs/crossword-mode-plan.md §7.2 step 3, §7.3, §7.4, §7.5, §12 worker).
 *
 * No Mongo: the REAL bank repo (`makeCrosswordBankRepo`) runs over a small
 * in-memory stand-in for the two native collections, so "only approved words
 * and approved clues" is checked end to end — fixture documents carry
 * approval and family-friendly fields as the plan describes them, and the
 * puzzle that comes out is checked against those fields. Puzzles and configs
 * are fake repos.
 */
jest.mock("../lib/openrouter", () => ({
  callOpenRouter: jest.fn(() => {
    throw new Error("model call from a crossword build");
  }),
}));
jest.mock("../summaries/openrouter", () => {
  throw new Error("summaries/openrouter imported by a crossword build");
});
jest.mock("../placeRoundups/openrouter", () => {
  throw new Error("placeRoundups/openrouter imported by a crossword build");
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanClue,
  DEFAULT_CROSSWORD_CONFIG,
  normalizeAnswer,
  validateClue,
  type CrosswordConfig,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";
import { CROSSWORD_SEED_WORDS } from "@photonsurge/shared/crossword-seeds";
import { makeCrosswordBankRepo } from "@photonsurge/shared/db/crossword-bank-repo";
import { buildPuzzle, CrosswordBuildError, indexBank, topUpScenes } from "./build";

// ---------------------------------------------------------------------------
// In-memory collections (just enough of the driver for the bank repo)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixture bank: documents in the prototype's shape plus the plan's §7.4 fields
// ---------------------------------------------------------------------------

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

const SEED = CROSSWORD_SEED_WORDS.map((w) => ({ answer: normalizeAnswer(w.answer), clue: w.clue }));

/** The seed set as approved, tagged bank words: one approved clue each, plus a pending and a rejected one. */
function approvedSeedSpecs(over: (w: WordSpec, i: number) => Partial<WordSpec> = () => ({})): WordSpec[] {
  return SEED.map((s, i) => {
    const base: WordSpec = {
      id: `w${i}`,
      answer: s.answer,
      clues: [
        { id: `w${i}-ok`, text: s.clue },
        { id: `w${i}-pending`, text: `Pending wording ${i}`, status: "pending" },
        { id: `w${i}-rejected`, text: `Rejected wording ${i}`, status: "rejected" },
      ],
    };
    return { ...base, ...over(base, i) };
  });
}

/** Ordinary words a layout loves, each with a clean clue; the tests set their status and tags. */
const EXTRA = [
  ["STARE", "Look fixedly"],
  ["RATES", "Prices per unit"],
  ["TREAT", "Something special to enjoy"],
  ["ASTER", "Daisy-like flower"],
  ["RESET", "Start over"],
  ["TEASER", "Short preview"],
  ["ARREST", "Take into custody"],
  ["STREET", "Road in a town"],
  ["TASTER", "Small sample"],
  ["SATIRE", "Mocking humour"],
  ["RETAIN", "Keep hold of"],
  ["ARISE", "Get up from bed"],
  ["SENATE", "Upper house"],
  ["EARNEST", "Serious and sincere"],
  ["STATE", "Condition"],
  ["TENSE", "Feeling anxious"],
  ["TREES", "Oaks and elms"],
  ["EASTER", "Spring holiday"],
  ["ROAST", "Cook in an oven"],
  ["TOAST", "Browned bread"],
  ["NOTES", "Jottings"],
  ["STONE", "Small pebble"],
  ["TONES", "Shades of colour"],
  ["ONSET", "Beginning"],
] as const;

function extraSpecs(prefix: string, over: Partial<WordSpec> & { clueStatus?: ClueSpec["status"]; clueFf?: Tag } = {}): WordSpec[] {
  const { clueStatus, clueFf, ...w } = over;
  return EXTRA.map(([answer, text], i) => ({
    id: `${prefix}${i}`,
    answer,
    ...w,
    clues: [{ id: `${prefix}${i}-c`, text, ...(clueStatus ? { status: clueStatus } : {}), ...(clueFf !== undefined ? { ff: clueFf } : {}) }],
  }));
}

// ---------------------------------------------------------------------------
// The fake AppDb
// ---------------------------------------------------------------------------

function fakeDb(opts: { bank?: WordSpec[]; cfg?: Partial<CrosswordConfig>; cfgs?: Record<string, Partial<CrosswordConfig>>; puzzles?: CrosswordPuzzle[]; scenes?: string[] } = {}) {
  const { words, clues } = bankDocs(opts.bank ?? []);
  const wordsCol = fakeCollection(words);
  const cluesCol = fakeCollection(clues);
  const conn = { db: { collection: (name: string) => (name === "crosswordbankwords" ? wordsCol : name === "crosswordbankclues" ? cluesCol : (null as any)) } };
  const crosswordBank = makeCrosswordBankRepo(conn as any);
  const puzzles: CrosswordPuzzle[] = [...(opts.puzzles ?? [])];
  const lastPlay = (p: CrosswordPuzzle, s: string) => Math.max(...p.plays.filter((x) => x.sceneId === s).map((x) => x.startedAt));
  const crosswordPuzzles = {
    // As the real repo: the scene's last n played puzzles, most recent first.
    recentForScene: jest.fn(async (sceneId: string, n: number) =>
      n <= 0
        ? []
        : puzzles
            .filter((p) => p.plays.some((x) => x.sceneId === sceneId))
            .sort((a, b) => lastPlay(b, sceneId) - lastPlay(a, sceneId))
            .slice(0, n)
            .map((p) => structuredClone(p)),
    ),
    upsert: jest.fn(async (p: CrosswordPuzzle) => {
      puzzles.push(structuredClone(p));
      return p;
    }),
    list: jest.fn(async (q: { status?: string } = {}) => puzzles.filter((p) => !q.status || p.status === q.status).map((p) => structuredClone(p))),
    model: { countDocuments: () => ({ exec: async () => puzzles.length }) },
  };
  const getOrInitCrosswordConfig = jest.fn(async (sceneId: string) => ({
    ...DEFAULT_CROSSWORD_CONFIG,
    ...opts.cfg,
    ...opts.cfgs?.[sceneId],
  }));
  const db = {
    crosswordBank,
    crosswordPuzzles,
    getOrInitCrosswordConfig,
    crosswordScenes: jest.fn(async () => opts.scenes ?? []),
  } as any;
  return { db, wordsCol, cluesCol, puzzles, crosswordPuzzles };
}

const FAST = { layout: { maxAttempts: 10, budgetMs: 1e12 } };
const SEEDS = [1, 2, 3, 4, 5, 6];

const filler = (n: number, sceneId: string, startedAt: number, answers: string[] = ["QQQ"], clueIds: string[] = []): CrosswordPuzzle => ({
  id: `p-${sceneId}-${n}`,
  title: `p${n}`,
  width: 1,
  height: 1,
  entries: answers.map((answer, i) => ({ id: `${i + 1}A`, num: i + 1, dir: "across", row: i * 2, col: 0, answer, clue: "x", wordId: "", clueId: clueIds[i] ?? "" })),
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 0,
  plays: [{ sceneId, startedAt }],
});

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

// ---------------------------------------------------------------------------

describe("fixture sanity", () => {
  it("every fixture clue is clean and passes validateClue, so a left-out clue is the build's choice", () => {
    for (const w of [...approvedSeedSpecs(), ...extraSpecs("x")]) {
      for (const c of w.clues) {
        expect(cleanClue(c.text)).toBe(c.text);
        expect(validateClue(c.text, w.answer)).toBeNull();
      }
    }
  });
});

describe("buildPuzzle: approved words and clues only (§7.3, §7.4)", () => {
  it.each(SEEDS)("seed %i: no pending or rejected word, and no pending or rejected clue, ever appears", async (seed) => {
    // Pending words with approved, tagged clues: only the word's approval keeps them out.
    const f = fakeDb({ bank: [...approvedSeedSpecs(), ...extraSpecs("pw", { status: "pending" })] });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed }, FAST);
    const p = r.puzzle;
    expect(p.entries.length).toBeGreaterThanOrEqual(10);
    for (const e of p.entries) {
      expect(e.wordId).toMatch(/^w\d+$/); // an approved seed-bank word, never a pending "pw" one
      expect(e.clueId).toBe(`${e.wordId}-ok`);
      expect(e.clue).toBe(SEED[Number(e.wordId.slice(1))].clue);
    }
  });

  it("control: the extra words do get placed once approved (so the exclusions above are not vacuous)", async () => {
    const bank = [...approvedSeedSpecs(), ...extraSpecs("ok")];
    let extras = 0;
    for (const seed of SEEDS) {
      const r = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed }, FAST);
      extras += r.puzzle.entries.filter((e) => e.wordId.startsWith("ok")).length;
    }
    expect(extras).toBeGreaterThan(0);
  });

  it("a word with no approved clue never appears, though the word itself is approved", async () => {
    // Every extra word is approved and tagged, but its only clue is pending.
    const bank = [...approvedSeedSpecs(), ...extraSpecs("nc", { clueStatus: "pending" })];
    for (const seed of SEEDS) {
      const r = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) expect(e.wordId.startsWith("nc")).toBe(false);
    }
  });

  it("a rejected word never appears", async () => {
    const bank = [...approvedSeedSpecs(), ...extraSpecs("rw", { status: "rejected" })];
    for (const seed of SEEDS) {
      const r = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) expect(e.wordId.startsWith("rw")).toBe(false);
    }
  });

  it("stores the puzzle `ready`, entries carrying wordId and clueId, and makes no model call", async () => {
    const f = fakeDb({ bank: approvedSeedSpecs() });
    const fetchSpy = jest.spyOn(globalThis as any, "fetch").mockImplementation(() => {
      throw new Error("network call from a crossword build");
    });
    try {
      const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 9 }, FAST);
      expect(r.puzzle.status).toBe("ready");
      expect(f.crosswordPuzzles.upsert).toHaveBeenCalledTimes(1);
      const stored = f.puzzles[f.puzzles.length - 1];
      expect(stored.status).toBe("ready");
      for (const e of stored.entries) {
        expect(e.wordId).toEqual(expect.any(String));
        expect(e.wordId).not.toBe("");
        expect(e.clueId).toEqual(expect.any(String));
        expect(e.clueId).not.toBe("");
        // The ids name the very bank documents the answer and clue came from.
        const w = f.wordsCol.docs.find((d) => d._id === e.wordId)!;
        const c = f.cluesCol.docs.find((d) => d._id === e.clueId)!;
        expect(w.norm).toBe(e.answer);
        expect(c.answerId).toBe(e.wordId);
        expect(c.clue).toBe(e.clue);
      }
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(jest.requireMock("../lib/openrouter").callOpenRouter).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("no crossword build module imports a model client", () => {
    for (const file of ["build.ts", "pick.ts", "layout.ts", "build-jobs.ts"]) {
      const src = readFileSync(join(__dirname, file), "utf8");
      expect(src).not.toMatch(/from\s+["'][^"']*openrouter[^"']*["']/i);
      expect(src).not.toMatch(/require\(\s*["'][^"']*openrouter/i);
      expect(src).not.toMatch(/callOpenRouter\s*\(/);
      expect(src).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("is repeatable for a seed", async () => {
    const bank = [...approvedSeedSpecs(), ...extraSpecs("x")];
    const a = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed: 77 }, FAST);
    const b = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed: 77 }, FAST);
    const shape = (p: CrosswordPuzzle) => p.entries.map((e) => [e.id, e.row, e.col, e.answer, e.wordId, e.clueId]);
    expect(shape(b.puzzle)).toEqual(shape(a.puzzle));
  });
});

describe("CROSSWORD_ALLOW_UNAPPROVED (§7.4, dev only)", () => {
  // Only pending words in the bank (a dev box before anything is approved).
  const pendingOnly = () => extraSpecs("pw", { status: "pending", ff: null, clueStatus: "pending", clueFf: null }).concat(
    approvedSeedSpecs((w) => ({ status: "pending", ff: null, clues: [{ id: `${w.id}-p`, text: SEED[Number(w.id.slice(1))].clue, status: "pending", ff: null }] })),
  );

  it("off by default: a bank of pending words cannot make a puzzle", async () => {
    await expect(buildPuzzle(fakeDb({ bank: pendingOnly() }).db, { sceneId: "xw", seed: 1 }, FAST)).rejects.toBeInstanceOf(CrosswordBuildError);
  });

  it.each(["false", "1", "yes", "TRUE "])("anything but \"true\" (%p) leaves it off", async (v) => {
    process.env[ENV] = v;
    await expect(buildPuzzle(fakeDb({ bank: pendingOnly() }).db, { sceneId: "xw", seed: 1 }, FAST)).rejects.toBeInstanceOf(CrosswordBuildError);
  });

  it("=true lets the build use pending words with their stored clues", async () => {
    process.env[ENV] = "true";
    const f = fakeDb({ bank: pendingOnly() });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 1 }, FAST);
    expect(r.puzzle.entries.length).toBeGreaterThanOrEqual(10);
    expect(r.puzzle.status).toBe("ready");
    // Nothing in it is tagged, so the puzzle is not family friendly.
    expect(r.puzzle.familyFriendly).toBe(false);
    for (const e of r.puzzle.entries) {
      const c = f.cluesCol.docs.find((d) => d._id === e.clueId)!;
      expect(c.answerId).toBe(e.wordId);
    }
  });

  it("=true still never uses a rejected word or a rejected clue", async () => {
    process.env[ENV] = "true";
    const bank = [
      ...approvedSeedSpecs(),
      ...extraSpecs("rw", { status: "rejected" }),
    ];
    for (const seed of SEEDS.slice(0, 3)) {
      const r = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) {
        expect(e.wordId.startsWith("rw")).toBe(false);
        expect(e.clueId.endsWith("-rejected")).toBe(false);
      }
    }
  });
});

describe("family friendly (§7.3 step 5, §7.4)", () => {
  // Seed words fully tagged; the extras each have one tagging defect.
  const defects: Partial<WordSpec & { clueFf: Tag }>[] = [
    { ff: null }, // word untagged
    { ff: false }, // word tagged not
    { clueFf: null }, // clue untagged
    { clueFf: false }, // clue tagged not
  ];
  const mixedBank = () => [
    ...approvedSeedSpecs(),
    ...defects.flatMap((d, k) => extraSpecs(`d${k}x`, d).slice(k * 6, k * 6 + 6)),
  ];

  it.each(SEEDS)("seed %i: on a family-friendly channel every word and clue is tagged; untagged counts as not", async (seed) => {
    const f = fakeDb({ bank: mixedBank(), cfg: { familyFriendlyOnly: true } });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed }, FAST);
    for (const e of r.puzzle.entries) {
      const w = f.wordsCol.docs.find((d) => d._id === e.wordId)!;
      const c = f.cluesCol.docs.find((d) => d._id === e.clueId)!;
      expect(w.familyFriendly).toBe(true);
      expect(c.familyFriendly).toBe(true);
    }
    expect(r.puzzle.familyFriendly).toBe(true);
  });

  it("an approved word whose only family-friendly clue is pending is left out on a family-friendly channel", async () => {
    // Extras: word tagged, approved clue untagged, a tagged clue still pending.
    const bank = [
      ...approvedSeedSpecs(),
      ...EXTRA.map(([answer, text], i) => ({
        id: `pc${i}`,
        answer,
        clues: [
          { id: `pc${i}-a`, text, ff: null },
          { id: `pc${i}-b`, text: `${text}, perhaps`, status: "pending" as const, ff: true },
        ],
      })),
    ];
    for (const seed of SEEDS) {
      const r = await buildPuzzle(fakeDb({ bank, cfg: { familyFriendlyOnly: true } }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) expect(e.wordId.startsWith("pc")).toBe(false);
    }
  });

  it.each(SEEDS)("seed %i: the flag is set exactly when every word and clue in the puzzle is tagged", async (seed) => {
    const f = fakeDb({ bank: mixedBank(), cfg: { familyFriendlyOnly: false } });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed }, FAST);
    const allTagged = r.puzzle.entries.every((e) => {
      const w = f.wordsCol.docs.find((d) => d._id === e.wordId)!;
      const c = f.cluesCol.docs.find((d) => d._id === e.clueId)!;
      return w.familyFriendly === true && c.familyFriendly === true;
    });
    expect(r.puzzle.familyFriendly).toBe(allTagged);
  });

  it("control: off the switch the defective words do get placed, so both sides of the flag are exercised", async () => {
    const flags = new Set<boolean>();
    for (const seed of SEEDS) {
      const r = await buildPuzzle(fakeDb({ bank: mixedBank(), cfg: { familyFriendlyOnly: false } }).db, { sceneId: "xw", seed }, FAST);
      if (r.puzzle.entries.some((e) => e.wordId.startsWith("d"))) flags.add(r.puzzle.familyFriendly);
    }
    expect(flags.has(false)).toBe(true);
  });

  it("off the switch, an untagged puzzle is stored with familyFriendly false", async () => {
    // Nothing tagged at all.
    const bank = approvedSeedSpecs((w) => ({ ff: null, clues: w.clues.map((c) => ({ ...c, ff: null })) }));
    const r = await buildPuzzle(fakeDb({ bank, cfg: { familyFriendlyOnly: false } }).db, { sceneId: "xw", seed: 4 }, FAST);
    expect(r.puzzle.familyFriendly).toBe(false);
  });

  it("off the switch, a fully tagged puzzle is still flagged family friendly", async () => {
    const r = await buildPuzzle(fakeDb({ bank: approvedSeedSpecs(), cfg: { familyFriendlyOnly: false } }).db, { sceneId: "xw", seed: 4 }, FAST);
    expect(r.puzzle.familyFriendly).toBe(true);
  });

  it("the channel switch defaults on", () => {
    expect(DEFAULT_CROSSWORD_CONFIG.familyFriendlyOnly).toBe(true);
  });
});

describe("choosing the clue (§7.3 step 3)", () => {
  /** Each seed word with three approved clues a, b, c. */
  const threeClues = (cStatus: ClueSpec["status"] = "approved") =>
    approvedSeedSpecs((w, i) => ({
      clues: [
        { id: `${w.id}-a`, text: SEED[i].clue },
        { id: `${w.id}-b`, text: `Also, ${SEED[i].clue.toLowerCase()}` },
        { id: `${w.id}-c`, text: `Or: ${SEED[i].clue.toLowerCase()}`, status: cStatus },
      ],
    }));
  const allIds = (suffix: string) => SEED.map((_, i) => `w${i}-${suffix}`);
  const allAnswers = SEED.map((s) => s.answer);
  // 20 more recent puzzles fill the word no-repeat window, so the clue history below is older than it.
  const window = Array.from({ length: 20 }, (_, n) => filler(n, "xw", 10_000 + n));

  it("fixture sanity: the variant clues validate", () => {
    for (const w of threeClues()) for (const c of w.clues) expect(validateClue(c.text, w.answer)).toBeNull();
  });

  it("a clue this channel never used comes first", async () => {
    const puzzles = [...window, filler(100, "xw", 500, allAnswers, allIds("a")), filler(101, "xw", 300, allAnswers, allIds("b"))];
    for (const seed of SEEDS.slice(0, 3)) {
      const r = await buildPuzzle(fakeDb({ bank: threeClues(), puzzles }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) expect(e.clueId).toBe(`${e.wordId}-c`);
    }
  });

  it("otherwise the approved clue this channel used longest ago (a pending one is never chosen)", async () => {
    const puzzles = [...window, filler(100, "xw", 500, allAnswers, allIds("a")), filler(101, "xw", 300, allAnswers, allIds("b"))];
    for (const seed of SEEDS.slice(0, 3)) {
      const r = await buildPuzzle(fakeDb({ bank: threeClues("pending"), puzzles }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) expect(e.clueId).toBe(`${e.wordId}-b`);
    }
  });

  it("only this channel's use counts, not another channel's", async () => {
    const puzzles = [
      ...window,
      filler(100, "xw", 300, allAnswers, allIds("a")),
      filler(101, "xw", 500, allAnswers, allIds("b")),
      // Another channel used every "a" clue most recently of all.
      filler(102, "yy", 9_000, allAnswers, allIds("a")),
    ];
    const r = await buildPuzzle(fakeDb({ bank: threeClues("pending"), puzzles }).db, { sceneId: "xw", seed: 2 }, FAST);
    for (const e of r.puzzle.entries) expect(e.clueId).toBe(`${e.wordId}-a`);
  });
});

describe("validateClue as a guard (§7.3 step 4)", () => {
  it("an approved clue that leaks its answer or hits the blocklist is never used", async () => {
    const bank = approvedSeedSpecs((w, i) => ({
      clues: [
        // Ids sort these first, so only the guard keeps them out.
        { id: `${w.id}-0leak`, text: `It is ${SEED[i].answer.toLowerCase()} here` },
        { id: `${w.id}-1block`, text: `Zorblax thing number ${i}` },
        { id: `${w.id}-2ok`, text: SEED[i].clue },
      ],
    }));
    for (const seed of SEEDS.slice(0, 3)) {
      const r = await buildPuzzle(fakeDb({ bank, cfg: { blocklist: ["zorblax"] } }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) {
        expect(e.clueId).toBe(`${e.wordId}-2ok`);
        expect(validateClue(e.clue, e.answer, ["zorblax"])).toBeNull();
      }
    }
  });

  it("a word whose every approved clue fails the guard never appears", async () => {
    const bank = [
      ...approvedSeedSpecs(),
      ...EXTRA.map(([answer], i) => ({ id: `bad${i}`, answer, clues: [{ id: `bad${i}-c`, text: `The word ${answer.toLowerCase()} itself` }] })),
    ];
    for (const seed of SEEDS) {
      const r = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) expect(e.wordId.startsWith("bad")).toBe(false);
    }
  });
});

describe("minZipf and the no-repeat window (§7.3 step 1)", () => {
  it("never uses an approved word below the channel's minZipf", async () => {
    const bank = [
      ...approvedSeedSpecs(() => ({ zipf: 4.5 })),
      ...extraSpecs("lo", { zipf: 4.49 }),
    ];
    for (const seed of SEEDS) {
      const r = await buildPuzzle(fakeDb({ bank, cfg: { minZipf: 4.5 } }).db, { sceneId: "xw", seed }, FAST);
      for (const e of r.puzzle.entries) expect(e.wordId.startsWith("lo")).toBe(false);
    }
  });

  it("minZipf defaults to 3.5 and the no-repeat window to 20 puzzles", () => {
    expect(DEFAULT_CROSSWORD_CONFIG.minZipf).toBe(3.5);
    expect(DEFAULT_CROSSWORD_CONFIG.noRepeatWordsPuzzles).toBe(20);
  });

  it("never reuses a word from the channel's last 20 puzzles", async () => {
    const bank = [...approvedSeedSpecs(), ...extraSpecs("x")];
    // Each extra word sits in one of the channel's last 20 puzzles.
    const puzzles = EXTRA.slice(0, 20).map(([answer], n) => filler(n, "xw", 1_000 + n, [answer]));
    for (const seed of SEEDS) {
      const r = await buildPuzzle(fakeDb({ bank, puzzles }).db, { sceneId: "xw", seed }, FAST);
      const used = new Set(EXTRA.slice(0, 20).map(([a]) => a));
      for (const e of r.puzzle.entries) expect(used.has(e.answer)).toBe(false);
    }
  });
});

describe("a pool too small (§7.3 step 4)", () => {
  it("fails clearly, saying how many approved words were available", async () => {
    const bank = approvedSeedSpecs().slice(0, 7);
    const err = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed: 1 }, FAST).catch((e) => e);
    expect(err).toBeInstanceOf(CrosswordBuildError);
    expect(err.message).toMatch(/\b7\b/);
    expect(err.message).toMatch(/approved/i);
  });

  it("counts what this channel may use: pending words do not swell the number", async () => {
    const bank = [...approvedSeedSpecs().slice(0, 5), ...extraSpecs("pw", { status: "pending" })];
    const err = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed: 1 }, FAST).catch((e) => e);
    expect(err).toBeInstanceOf(CrosswordBuildError);
    expect(err.message).toMatch(/\b5\b/);
    expect(err.message).not.toMatch(new RegExp(`\\b${5 + EXTRA.length}\\b`));
  });

  it("stores nothing when it fails", async () => {
    const f = fakeDb({ bank: approvedSeedSpecs().slice(0, 3) });
    await expect(buildPuzzle(f.db, { sceneId: "xw", seed: 1 }, FAST)).rejects.toBeInstanceOf(CrosswordBuildError);
    expect(f.crosswordPuzzles.upsert).not.toHaveBeenCalled();
  });
});

describe("no bank imported (§7.3 seed set)", () => {
  it("builds a ready, family-friendly puzzle from the seed set", async () => {
    const r = await buildPuzzle(fakeDb({ bank: [] }).db, { sceneId: "xw", seed: 3 }, FAST);
    expect(r.puzzle.status).toBe("ready");
    expect(r.puzzle.familyFriendly).toBe(true);
    expect(r.puzzle.entries.length).toBeGreaterThanOrEqual(10);
    const seeds = new Map(CROSSWORD_SEED_WORDS.map((w) => [w.id, w]));
    for (const e of r.puzzle.entries) {
      const s = seeds.get(e.wordId)!;
      expect(s).toBeDefined();
      expect(e.clueId).toBe(s.clueId);
    }
  });
});

// ---------------------------------------------------------------------------
// Top-up (§7.5)
// ---------------------------------------------------------------------------

describe("topUpScenes (§7.5)", () => {
  const ready = (n: number, ff: boolean, playedBy: string[] = []): CrosswordPuzzle[] =>
    Array.from({ length: n }, (_, i) => ({
      ...filler(i, "none", 0),
      id: `stock-${ff ? "ff" : "nf"}-${i}-${playedBy.join("")}`,
      familyFriendly: ff,
      plays: playedBy.map((sceneId) => ({ sceneId, startedAt: 1 })),
    }));

  it("builds only for enabled channels below stockTarget (6 by default), and only one puzzle each", async () => {
    expect(DEFAULT_CROSSWORD_CONFIG.stockTarget).toBe(6);
    const f = fakeDb({
      bank: approvedSeedSpecs(),
      scenes: ["low", "off", "full"],
      cfgs: {
        low: { enabled: true, familyFriendlyOnly: false },
        off: { enabled: false, familyFriendlyOnly: false },
        full: { enabled: true, familyFriendlyOnly: false },
      },
      // 6 unplayed for "full"; all 6 already played by "low", so low has 0.
      puzzles: ready(6, true, ["low"]),
    });
    const out = await topUpScenes(f.db, FAST);
    const by = Object.fromEntries(out.map((o) => [o.sceneId, o]));
    expect(by.low.outcome).toBe("built");
    expect(by.off.outcome).not.toBe("built");
    expect(by.full.outcome).not.toBe("built");
    expect(f.crosswordPuzzles.upsert).toHaveBeenCalledTimes(1);
  });

  it("is family-friendly aware: a family-friendly channel does not count untagged stock", async () => {
    const f = fakeDb({
      bank: approvedSeedSpecs(),
      scenes: ["ff", "open"],
      cfgs: { ff: { enabled: true, familyFriendlyOnly: true }, open: { enabled: true, familyFriendlyOnly: false } },
      puzzles: ready(8, false),
    });
    const out = await topUpScenes(f.db, FAST);
    const by = Object.fromEntries(out.map((o) => [o.sceneId, o]));
    expect(by.ff.outcome).toBe("built");
    expect(by.open.outcome).not.toBe("built");
    const built = f.puzzles.find((p) => p.id === (by.ff as any).puzzleId)!;
    expect(built.familyFriendly).toBe(true);
  });

  it("skips with a reason when the pool cannot supply a puzzle, and carries on with the others", async () => {
    const f = fakeDb({
      bank: [...approvedSeedSpecs(() => ({ zipf: 5 }))],
      scenes: ["thin", "fine"],
      // "thin" asks for words rarer-than-possible; nothing qualifies.
      cfgs: { thin: { enabled: true, minZipf: 8 }, fine: { enabled: true } },
    });
    const out = await topUpScenes(f.db, FAST);
    const by = Object.fromEntries(out.map((o) => [o.sceneId, o])) as Record<string, any>;
    expect(by.thin.outcome).toBe("skipped");
    expect(typeof by.thin.reason).toBe("string");
    expect(by.thin.reason).toMatch(/\b0\b/);
    expect(by.fine.outcome).toBe("built");
  });

  it("a family-friendly channel with no tagged pool is skipped, not given an untagged puzzle", async () => {
    const bank = approvedSeedSpecs(() => ({ ff: null }));
    const f = fakeDb({ bank, scenes: ["ff"], cfgs: { ff: { enabled: true, familyFriendlyOnly: true } } });
    const out = await topUpScenes(f.db, FAST);
    expect(out[0]).toMatchObject({ sceneId: "ff", outcome: "skipped" });
    expect(f.crosswordPuzzles.upsert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The bank index (§7.2 step 3)
// ---------------------------------------------------------------------------

describe("indexBank (§7.2 step 3)", () => {
  const keysOf = (col: ReturnType<typeof fakeCollection>) => [...col.indexes.values()].map((k) => Object.keys(JSON.parse(k)));

  it("builds the plan's indexes on words and clues", async () => {
    const f = fakeDb({ bank: approvedSeedSpecs().slice(0, 2) });
    await indexBank(f.db);
    const wordKeys = keysOf(f.wordsCol);
    for (const field of ["norm", "enrichment.status", "updatedAt", "length"]) {
      expect(wordKeys.some((k) => k.length === 1 && k[0] === field)).toBe(true);
    }
    // One compound for the pick: approval, family friendly, length, frequency.
    expect(
      wordKeys.some(
        (k) =>
          k.includes("approval.status") &&
          k.includes("familyFriendly") &&
          k.includes("length") &&
          k.includes("validation.sources.wordfreq.zipf"),
      ),
    ).toBe(true);
    expect(keysOf(f.cluesCol).some((k) => k[0] === "answerId")).toBe(true);
  });

  it("drops the old xwbank_pick_ix", async () => {
    const f = fakeDb({ bank: approvedSeedSpecs().slice(0, 2) });
    f.wordsCol.indexes.set("xwbank_pick_ix", JSON.stringify({ "validation.decision": 1, length: 1 }));
    const r = await indexBank(f.db);
    expect(f.wordsCol.indexes.has("xwbank_pick_ix")).toBe(false);
    expect(r.dropped).toContain("xwbank_pick_ix");
  });

  it("is idempotent: a second run succeeds and changes nothing", async () => {
    const f = fakeDb({ bank: approvedSeedSpecs().slice(0, 2) });
    f.wordsCol.indexes.set("xwbank_pick_ix", JSON.stringify({ "validation.decision": 1 }));
    const first = await indexBank(f.db);
    const words1 = new Map(f.wordsCol.indexes);
    const clues1 = new Map(f.cluesCol.indexes);
    const second = await indexBank(f.db);
    expect(new Map(f.wordsCol.indexes)).toEqual(words1);
    expect(new Map(f.cluesCol.indexes)).toEqual(clues1);
    expect(second.indexes.sort()).toEqual(first.indexes.sort());
    expect(second.dropped).toEqual([]);
  });

  it("works on a bank with no documents", async () => {
    const f = fakeDb({ bank: [] });
    await expect(indexBank(f.db)).resolves.toBeDefined();
    await expect(indexBank(f.db)).resolves.toBeDefined();
  });
});

import { DEFAULT_CROSSWORD_CONFIG, validateClue, type CrosswordConfig, type CrosswordPuzzle } from "@photonsurge/shared/crossword";
import { CROSSWORD_SEED_WORDS, isSeedId } from "@photonsurge/shared/crossword-seeds";
import {
  buildPuzzle,
  channelStock,
  chooseClue,
  CLUE_HISTORY_PUZZLES,
  clueLastUsed,
  CrosswordBuildError,
  DEV_FAMILY_FRIENDLY_REASON,
  indexBank,
  recheckPuzzle,
  topUpScenes,
} from "./build";

interface FakeClue {
  id: string;
  text: string;
  familyFriendly: boolean | null;
}
interface FakeWord {
  id: string;
  norm: string;
  length: number;
  zipf: number;
  familyFriendly: boolean | null;
  clues: FakeClue[];
}

/** The seed set dressed as an approved bank: each word with its seed clue and a leaky one. */
const WORDS: FakeWord[] = CROSSWORD_SEED_WORDS.map((w, i) => ({
  id: `b${i}`,
  norm: w.answer,
  length: w.answer.length,
  zipf: 5,
  familyFriendly: true,
  clues: [
    { id: `b${i}c1`, text: w.clue, familyFriendly: true },
    { id: `b${i}c0`, text: `It is ${w.answer.toLowerCase()} here`, familyFriendly: true },
  ],
}));

function fakeDb(
  opts: {
    cfg?: Partial<CrosswordConfig>;
    bank?: FakeWord[];
    /** Words in the bank collection (default: the bank's length). */
    imported?: number;
    scenes?: string[];
    ready?: any[];
    /** The scene's played puzzles, most recent first. */
    played?: CrosswordPuzzle[];
    stored?: number;
    indexes?: string[];
    /** Decisions taken during the build, over the bank's (all approved, tagged as listed). */
    changed?: Record<string, { status: "pending" | "approved" | "rejected"; familyFriendly: boolean | null }>;
  } = {},
) {
  const bank = opts.bank ?? WORDS;
  // The repo's rules: on a family-friendly pick the word and the clue are both tagged.
  const playable = jest.fn(async (q: any) =>
    bank
      .filter((w) => !q.familyFriendlyOnly || q.allowUnapproved || w.familyFriendly === true)
      .map((w) => ({ ...w, clues: w.clues.filter((c) => !q.familyFriendlyOnly || q.allowUnapproved || c.familyFriendly === true) }))
      .filter((w) => w.clues.length),
  );
  const have = new Set(opts.indexes ?? []);
  const words = {
    estimatedDocumentCount: jest.fn(async () => opts.imported ?? bank.length),
    indexExists: jest.fn(async (n: string) => have.has(n)),
    dropIndex: jest.fn(async (n: string) => void have.delete(n)),
  };
  const ensureIndexes = jest.fn(async () => {
    for (const n of ["xwbank_norm_ix", "xwbank_approved_pick_ix"]) have.add(n);
    return ["xwbank_norm_ix", "xwbank_approved_pick_ix"];
  });
  const poolCounts = jest.fn(async () => ({ words: 120, ffWords: 40, puzzlesWithoutRepeat: 8, ffPuzzlesWithoutRepeat: 2, targetWords: 280 }));
  const upsert = jest.fn(async (p: any) => p);
  const list = jest.fn(async (_q?: any) => opts.ready ?? []);
  const recentForScene = jest.fn(async (_s: string, n: number) => (opts.played ?? []).slice(0, n));
  // The bank as it stands after the store: as picked, unless a decision changed it.
  const decisionsFor = jest.fn(async (ids: string[]) => {
    const now: Record<string, { status: string; familyFriendly: boolean | null }> = {};
    for (const w of bank) {
      now[w.id] = { status: "approved", familyFriendly: w.familyFriendly };
      for (const c of w.clues) now[c.id] = { status: "approved", familyFriendly: c.familyFriendly };
    }
    Object.assign(now, opts.changed);
    return Object.fromEntries(ids.filter((id) => now[id]).map((id) => [id, now[id]]));
  });
  const setStatus = jest.fn(async () => true);
  const setFamilyFriendly = jest.fn(async () => true);
  const db = {
    getOrInitCrosswordConfig: jest.fn(async () => ({ ...DEFAULT_CROSSWORD_CONFIG, ...opts.cfg })),
    crosswordScenes: jest.fn(async () => opts.scenes ?? []),
    crosswordBank: { playable, words: () => words, ensureIndexes, poolCounts, decisionsFor },
    crosswordPuzzles: {
      setStatus,
      setFamilyFriendly,
      recentForScene,
      upsert,
      list,
      model: { countDocuments: () => ({ exec: async () => opts.stored ?? 0 }) },
    },
  } as any;
  return { db, playable, upsert, ensureIndexes, words, have, poolCounts, decisionsFor, setStatus, setFamilyFriendly };
}

const FAST = { layout: { maxAttempts: 8, budgetMs: 1e9 }, allowUnapproved: false };

const played = (id: string, clueIds: string[], startedAt: number, sceneId = "xw"): CrosswordPuzzle => ({
  id,
  title: id,
  width: 1,
  height: 1,
  entries: clueIds.map((clueId, i) => ({ id: `${i}A`, num: i, dir: "across", row: 0, col: 0, answer: "X", clue: "x", wordId: "", clueId })),
  status: "ready",
  familyFriendly: true,
  source: "bank",
  createdAt: 0,
  plays: [{ sceneId, startedAt }],
});

describe("buildPuzzle", () => {
  it("builds a ready puzzle from the approved pool, entries carrying wordId and clueId", async () => {
    const f = fakeDb({ stored: 41 });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    const p = r.puzzle;
    expect(f.playable).toHaveBeenCalledWith(
      expect.objectContaining({ minZipf: DEFAULT_CROSSWORD_CONFIG.minZipf, familyFriendlyOnly: true, allowUnapproved: false }),
    );
    expect(p).toMatchObject({ status: "ready", source: "bank", title: "Puzzle 42", familyFriendly: true, plays: [] });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.entries.length).toBeGreaterThanOrEqual(10);
    for (const e of p.entries) {
      const w = WORDS.find((x) => x.norm === e.answer)!;
      expect(e.wordId).toBe(w.id);
      // Never the leaky clue, though its id sorts first.
      expect(e.clueId).toBe(`${w.id}c1`);
      expect(e.clue).toBe(w.clues[0].text);
      expect(validateClue(e.clue, e.answer)).toBeNull();
    }
    expect(f.upsert).toHaveBeenCalledWith(p);
  });

  it("reads CROSSWORD_ALLOW_UNAPPROVED for the pick", async () => {
    const was = process.env.CROSSWORD_ALLOW_UNAPPROVED;
    try {
      process.env.CROSSWORD_ALLOW_UNAPPROVED = "true";
      const f = fakeDb();
      const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, { layout: FAST.layout });
      expect(f.playable).toHaveBeenCalledWith(expect.objectContaining({ allowUnapproved: true }));
      expect(r.unapproved).toBe(true);
      // The puzzle carries the dev marker, so a box without the switch never airs it.
      expect(r.puzzle.unapproved).toBe(true);
      process.env.CROSSWORD_ALLOW_UNAPPROVED = "1";
      const g = fakeDb();
      const r2 = await buildPuzzle(g.db, { sceneId: "xw", seed: 3 }, { layout: FAST.layout });
      expect(g.playable).toHaveBeenCalledWith(expect.objectContaining({ allowUnapproved: false }));
      expect(r2.puzzle).not.toHaveProperty("unapproved");
    } finally {
      if (was === undefined) delete process.env.CROSSWORD_ALLOW_UNAPPROVED;
      else process.env.CROSSWORD_ALLOW_UNAPPROVED = was;
    }
  });

  it("chooses the clue this channel used longest ago", async () => {
    const bank = WORDS.map((w) => ({
      ...w,
      clues: [
        { id: `${w.id}a`, text: `First clue for word ${w.id}`, familyFriendly: true },
        { id: `${w.id}b`, text: `Second clue for word ${w.id}`, familyFriendly: true },
      ],
    }));
    // Every "a" clue played recently, every "b" clue long ago.
    const f = fakeDb({ bank, played: [played("p2", bank.map((w) => `${w.id}a`), 200), played("p1", bank.map((w) => `${w.id}b`), 100)] });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, { ...FAST });
    for (const e of r.puzzle.entries) expect(e.clueId).toMatch(/b$/);
  });

  it("is family friendly only when every word and clue is tagged", async () => {
    const off = { familyFriendlyOnly: false };
    const untaggedClue = WORDS.map((w) => ({ ...w, clues: w.clues.map((c) => ({ ...c, familyFriendly: null })) }));
    expect((await buildPuzzle(fakeDb({ cfg: off, bank: untaggedClue }).db, { sceneId: "xw", seed: 3 }, FAST)).puzzle.familyFriendly).toBe(false);
    const untaggedWord = WORDS.map((w) => ({ ...w, familyFriendly: false }));
    expect((await buildPuzzle(fakeDb({ cfg: off, bank: untaggedWord }).db, { sceneId: "xw", seed: 3 }, FAST)).puzzle.familyFriendly).toBe(false);
    expect((await buildPuzzle(fakeDb({ cfg: off }).db, { sceneId: "xw", seed: 3 }, FAST)).puzzle.familyFriendly).toBe(true);
  });

  it("drops a word whose only clues fail the guard, the scene's blocklist included", async () => {
    const bad = new Set(WORDS.slice(0, 6).map((w) => w.norm));
    const bank = WORDS.map((w) => (bad.has(w.norm) ? { ...w, clues: [{ id: `${w.id}z`, text: "A blockedword in here", familyFriendly: true }] } : w));
    const r = await buildPuzzle(fakeDb({ bank, cfg: { blocklist: ["blockedword"] } }).db, { sceneId: "xw", seed: 3 }, FAST);
    expect(r.puzzle.entries.some((e) => bad.has(e.answer))).toBe(false);
  });

  it("fails saying how many approved words were available", async () => {
    const f = fakeDb({ bank: WORDS.slice(0, 7), cfg: { familyFriendlyOnly: false } });
    const err = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST).catch((e) => e);
    expect(err).toBeInstanceOf(CrosswordBuildError);
    expect(err.message).toMatch(/need 10/);
    expect(err.message).toMatch(/7 approved word/);
    expect(err.message).toMatch(/120 word/);
    expect(err.message).not.toMatch(/family friendly/);
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("names the family-friendly count when the channel's switch is on", async () => {
    const bank = WORDS.map((w, i) => (i < 5 ? w : { ...w, familyFriendly: null }));
    const err = await buildPuzzle(fakeDb({ bank }).db, { sceneId: "xw", seed: 3 }, FAST).catch((e) => e);
    expect(err).toBeInstanceOf(CrosswordBuildError);
    expect(err.message).toMatch(/5 family-friendly approved word/);
    expect(err.message).toMatch(/120 word\(s\), 40 family friendly/);
  });

  it("fails when the layout cannot reach minWords", async () => {
    const f = fakeDb({ bank: WORDS.slice(0, 12), cfg: { minWords: 12 } });
    await expect(buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST)).rejects.toThrow(/layout placed .*12 family-friendly approved/);
  });

  it("does not fall back to the seed set when a bank is imported but nothing is approved", async () => {
    const f = fakeDb({ bank: [], imported: 1000 });
    await expect(buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST)).rejects.toThrow(/0 family-friendly approved/);
  });

  it("builds from the seed set on a box with no bank: approved, family friendly, seed ids", async () => {
    const f = fakeDb({ bank: [], stored: 0 });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    expect(r.puzzle).toMatchObject({ source: "seed", title: "Puzzle 1", status: "ready", familyFriendly: true });
    for (const e of r.puzzle.entries) {
      const s = CROSSWORD_SEED_WORDS.find((w) => w.answer === e.answer)!;
      expect(isSeedId(e.wordId) && isSeedId(e.clueId)).toBe(true);
      expect([e.wordId, e.clueId, e.clue]).toEqual([s.id, s.clueId, s.clue]);
    }
  });

  it("leaves out the words of the stock waiting to air, and counts its clues as just used", async () => {
    const waiting = { ...played("s1", ["b0c1"], 0), plays: [], entries: WORDS.slice(0, 8).map((w, i) => ({ ...played("x", [], 0).entries[0], id: `${i}A`, answer: w.norm, clueId: `${w.id}c1` })) };
    const f = fakeDb({ ready: [waiting], cfg: { familyFriendlyOnly: false } });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    const held = new Set(WORDS.slice(0, 8).map((w) => w.norm));
    expect(r.puzzle.entries.some((e) => held.has(e.answer))).toBe(false);
    expect(f.playable.mock.calls[0][0].excludeNorms).toEqual(expect.arrayContaining([...held]));
    // The clue history is bounded.
    expect(f.db.crosswordPuzzles.recentForScene).toHaveBeenCalledWith("xw", CLUE_HISTORY_PUZZLES);
  });

  it("takes the next title past the highest number, so a deleted puzzle does not cause a repeat", async () => {
    const newest = [{ ...played("a", [], 0), title: "Puzzle 9", plays: [], status: "rejected" }];
    const f = fakeDb({ stored: 4, ready: newest });
    expect((await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST)).puzzle.title).toBe("Puzzle 10");
    expect((await buildPuzzle(fakeDb({ stored: 4 }).db, { sceneId: "xw", seed: 3 }, FAST)).puzzle.title).toBe("Puzzle 5");
  });

  it("is repeatable for a seed, and stores nothing on a dry run", async () => {
    const a = await buildPuzzle(fakeDb().db, { sceneId: "xw", seed: 11 }, FAST);
    const f = fakeDb();
    const b = await buildPuzzle(f.db, { sceneId: "xw", seed: 11 }, { ...FAST, dryRun: true });
    expect(b.puzzle.entries).toEqual(a.puzzle.entries);
    expect(f.upsert).not.toHaveBeenCalled();
  });
});

describe("clue choice", () => {
  const word = {
    answer: "SUN",
    clues: [
      { id: "c1", text: "Star at the centre of things", familyFriendly: true },
      { id: "c2", text: "Our nearest star, seen by day", familyFriendly: true },
      { id: "c3", text: "Big ball of gas up there", familyFriendly: true },
    ],
  };

  it("takes a never-used clue first, then the oldest, ties by id", () => {
    expect(chooseClue(word, new Map([["c1", 5]]))!.id).toBe("c2");
    expect(chooseClue(word, new Map([["c1", 5], ["c2", 3], ["c3", 9]]))!.id).toBe("c2");
    expect(chooseClue(word, new Map())!.id).toBe("c1");
  });

  it("skips clues that fail validateClue, and returns null when none pass", () => {
    expect(chooseClue(word, new Map(), ["centre"])!.id).toBe("c2");
    expect(chooseClue({ answer: "SUN", clues: [{ id: "x", text: "Sunny", familyFriendly: true }] }, new Map())).toBeNull();
  });

  it("treats as waiting stock only unplayed ready puzzles the channel may play", () => {
    const fresh = { ...played("a", [], 0), plays: [] };
    const notFF = { ...fresh, id: "b", familyFriendly: false };
    const rejected = { ...fresh, id: "c", status: "rejected" as const };
    const playedElsewhere = played("d", [], 5, "yy");
    const all = [fresh, notFF, rejected, playedElsewhere];
    expect(channelStock(all, { familyFriendlyOnly: true }).map((p) => p.id)).toEqual(["a"]);
    expect(channelStock(all, { familyFriendlyOnly: false }).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("reads clue use from this scene's plays only, latest play wins", () => {
    const a = played("p1", ["c1", "c2"], 100);
    const b = played("p2", ["c1"], 300);
    const other = played("p3", ["c3"], 900, "elsewhere");
    const m = clueLastUsed([a, b, other], "xw");
    expect([...m.entries()].sort()).toEqual([["c1", 300], ["c2", 100]]);
  });
});

describe("topUpScenes", () => {
  const ready = (id: string, playedOn: string[] = [], familyFriendly = true) => ({
    id,
    status: "ready",
    familyFriendly,
    entries: [{}],
    plays: playedOn.map((sceneId) => ({ sceneId, startedAt: 1 })),
  });

  it("builds one puzzle for an enabled scene short of stock, and skips the rest", async () => {
    const f = fakeDb({ scenes: ["xw"], cfg: { enabled: true, stockTarget: 2 }, ready: [ready("p1")] });
    const out = await topUpScenes(f.db, FAST);
    expect(out).toEqual([expect.objectContaining({ sceneId: "xw", outcome: "built", familyFriendly: true })]);
    expect(f.upsert).toHaveBeenCalledTimes(1);

    const stocked = fakeDb({ scenes: ["xw"], cfg: { enabled: true, stockTarget: 1 }, ready: [ready("p1")] });
    expect(await topUpScenes(stocked.db, FAST)).toEqual([{ sceneId: "xw", outcome: "stocked" }]);

    const off = fakeDb({ scenes: ["xw"], cfg: { enabled: false } });
    expect(await topUpScenes(off.db, FAST)).toEqual([{ sceneId: "xw", outcome: "disabled" }]);
    expect(off.upsert).not.toHaveBeenCalled();
  });

  it("counts a played puzzle as spent, and a non-family-friendly one as no stock for a family-friendly channel", async () => {
    const f = fakeDb({ scenes: ["xw"], cfg: { enabled: true, stockTarget: 1 }, ready: [ready("p1", ["xw"])] });
    expect((await topUpScenes(f.db, FAST))[0].outcome).toBe("built");
    const g = fakeDb({ scenes: ["xw"], cfg: { enabled: true, stockTarget: 1 }, ready: [ready("p1", [], false)] });
    expect((await topUpScenes(g.db, FAST))[0].outcome).toBe("built");
    const h = fakeDb({ scenes: ["xw"], cfg: { enabled: true, stockTarget: 1, familyFriendlyOnly: false }, ready: [ready("p1", [], false)] });
    expect((await topUpScenes(h.db, FAST))[0].outcome).toBe("stocked");
  });

  it("skips with the reason when the pool cannot supply a puzzle, and carries on", async () => {
    const f = fakeDb({ scenes: ["a", "b"], cfg: { enabled: true }, bank: WORDS.slice(0, 4) });
    const out = await topUpScenes(f.db, FAST);
    expect(out.map((o) => o.outcome)).toEqual(["skipped", "skipped"]);
    expect(out[0]).toMatchObject({ reason: expect.stringMatching(/4 family-friendly approved word/) });
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("skips a family-friendly-only channel in dev mode, with the reason", async () => {
    const f = fakeDb({ scenes: ["a", "b"], cfg: { enabled: true } });
    f.db.getOrInitCrosswordConfig.mockImplementation(async (id: string) => ({
      ...DEFAULT_CROSSWORD_CONFIG,
      enabled: true,
      familyFriendlyOnly: id === "a",
    }));
    const out = await topUpScenes(f.db, { ...FAST, allowUnapproved: true });
    expect(out[0]).toEqual({ sceneId: "a", outcome: "skipped", reason: DEV_FAMILY_FRIENDLY_REASON });
    expect(DEV_FAMILY_FRIENDLY_REASON).toMatch(/turn Family friendly only off/);
    expect(out[1]).toMatchObject({ sceneId: "b", outcome: "built" });
  });

  it("reports any other failure as failed", async () => {
    const f = fakeDb({ scenes: ["a"], cfg: { enabled: true } });
    f.playable.mockRejectedValueOnce(new Error("mongo down"));
    expect(await topUpScenes(f.db, FAST)).toEqual([{ sceneId: "a", outcome: "failed", error: "mongo down" }]);
  });
});

describe("indexBank", () => {
  it("builds the bank indexes, drops the legacy pick index, and is safe to re-run", async () => {
    const f = fakeDb({ indexes: ["xwbank_pick_ix"] });
    const a = await indexBank(f.db);
    expect(a).toEqual({ indexes: ["xwbank_norm_ix", "xwbank_approved_pick_ix"], dropped: ["xwbank_pick_ix"] });
    expect(f.have.has("xwbank_pick_ix")).toBe(false);
    const b = await indexBank(f.db);
    expect(b).toEqual({ indexes: a.indexes, dropped: [] });
    expect(f.words.dropIndex).toHaveBeenCalledTimes(1);
  });
});

describe("a decision taken while a puzzle was built (§7.4)", () => {
  const firstWord = (p: CrosswordPuzzle) => p.entries[0];

  it("rejects the stored puzzle when one of its words was rejected meanwhile", async () => {
    // Build once to learn which words it uses, then again with one of them rejected.
    const dry = await buildPuzzle(fakeDb().db, { sceneId: "xw", seed: 3 }, { ...FAST, dryRun: true });
    const wid = firstWord(dry.puzzle).wordId;
    const f = fakeDb({ changed: { [wid]: { status: "rejected", familyFriendly: true } } });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    expect(f.upsert).toHaveBeenCalled();
    expect(f.setStatus).toHaveBeenCalledWith(r.puzzle.id, "rejected");
    expect(r.puzzle.status).toBe("rejected");
    expect(f.setFamilyFriendly).not.toHaveBeenCalled();
  });

  it("untags the stored puzzle when a clue's family-friendly tag came off", async () => {
    const dry = await buildPuzzle(fakeDb().db, { sceneId: "xw", seed: 3 }, { ...FAST, dryRun: true });
    expect(dry.puzzle.familyFriendly).toBe(true);
    const cid = firstWord(dry.puzzle).clueId;
    const f = fakeDb({ changed: { [cid]: { status: "approved", familyFriendly: false } } });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    expect(f.setFamilyFriendly).toHaveBeenCalledWith(r.puzzle.id, false);
    expect(r.puzzle).toMatchObject({ status: "ready", familyFriendly: false });
    expect(f.setStatus).not.toHaveBeenCalled();
  });

  it("leaves an unchanged puzzle alone, and a dry run reads nothing", async () => {
    const f = fakeDb();
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    expect(f.decisionsFor).toHaveBeenCalledTimes(1);
    expect(r.puzzle).toMatchObject({ status: "ready", familyFriendly: true });
    expect(f.setStatus).not.toHaveBeenCalled();
    const g = fakeDb();
    await buildPuzzle(g.db, { sceneId: "xw", seed: 3 }, { ...FAST, dryRun: true });
    expect(g.decisionsFor).not.toHaveBeenCalled();
  });

  it("recheckPuzzle: gone or not approved rejects (pending only on a dev puzzle is fine); seed puzzles are skipped", () => {
    const entries = [{ id: "1A", num: 1, dir: "across" as const, row: 0, col: 0, answer: "CAT", clue: "Pet", wordId: "w", clueId: "c" }];
    const ok = { w: { status: "approved" as const, familyFriendly: true }, c: { status: "approved" as const, familyFriendly: true } };
    const base = { entries, familyFriendly: true, source: "bank" as const };
    expect(recheckPuzzle(base, ok)).toEqual({ reject: false, untag: false });
    expect(recheckPuzzle(base, { w: ok.w })).toEqual({ reject: true, untag: true });
    expect(recheckPuzzle(base, { ...ok, c: { status: "pending", familyFriendly: true } }).reject).toBe(true);
    expect(recheckPuzzle({ ...base, unapproved: true }, { ...ok, c: { status: "pending", familyFriendly: null } })).toEqual({
      reject: false,
      untag: true,
    });
    expect(recheckPuzzle({ ...base, unapproved: true }, { ...ok, c: { status: "rejected", familyFriendly: true } }).reject).toBe(true);
    expect(recheckPuzzle({ ...base, familyFriendly: false }, { ...ok, w: { status: "approved", familyFriendly: null } }).untag).toBe(false);
    expect(recheckPuzzle({ ...base, source: "seed" }, {})).toEqual({ reject: false, untag: false });
  });
});

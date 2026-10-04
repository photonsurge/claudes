import { DEFAULT_CROSSWORD_CONFIG, validateClue, type CrosswordConfig } from "@photonsurge/shared/crossword";
import { CROSSWORD_SEED_WORDS } from "@photonsurge/shared/crossword-seeds";
import type { BankClue } from "@photonsurge/shared/crossword-bank";
import { approvedClue, buildPuzzle, CrosswordBuildError, GENERAL_TITLE, indexBank, rankStoredClues, topUpScenes } from "./build";

const clue = (id: string, text: string, status: BankClue["approval"]["status"] = "pending"): BankClue => ({
  id,
  text,
  approval: { status },
  familyFriendly: null,
});

/** The seed set dressed as a bank: one word per seed word, its clue stored with a "(N)" tail. */
const WORDS = CROSSWORD_SEED_WORDS.map((w, i) => ({ id: `b${i}`, norm: w.answer, length: w.answer.length, zipf: 5, clue: w.clue }));

function fakeDb(opts: {
  cfg?: Partial<CrosswordConfig>;
  bank?: typeof WORDS;
  /** Per answer: the clues the bank holds (default: the seed clue + "(N)" and a leaky one). */
  clues?: (w: (typeof WORDS)[number]) => BankClue[];
  scenes?: string[];
  ready?: any[];
  drafts?: any[];
} = {}) {
  const bank = opts.bank ?? WORDS;
  const cluesFor =
    opts.clues ??
    ((w) => [clue(`${w.id}c1`, `${w.clue} (${w.norm.length})`), clue(`${w.id}c2`, `It is ${w.norm.toLowerCase()} here`)]);
  const upsert = jest.fn(async (p: any) => p);
  const forBuild = jest.fn(async (ids: string[]) =>
    bank.filter((w) => ids.includes(w.id)).map((w) => ({ id: w.id, norm: w.norm, senses: [], clues: cluesFor(w) })),
  );
  const ensureIndexes = jest.fn(async () => ["xwbank_norm_ix", "xwbank_answer_ix"]);
  const list = jest.fn(async ({ status }: { status: string }) => (status === "ready" ? opts.ready ?? [] : opts.drafts ?? []));
  const db = {
    getOrInitCrosswordConfig: jest.fn(async () => ({ ...DEFAULT_CROSSWORD_CONFIG, ...opts.cfg })),
    crosswordScenes: jest.fn(async () => opts.scenes ?? []),
    crosswordBank: { playable: jest.fn(async () => bank.map(({ clue: _c, ...w }) => w)), forBuild, ensureIndexes },
    crosswordPuzzles: { recentForScene: jest.fn(async () => []), upsert, list },
  } as any;
  return { db, upsert, forBuild, ensureIndexes, list };
}

const FAST = { layout: { maxAttempts: 8, budgetMs: 1e9 } };

describe("buildPuzzle", () => {
  it("builds from the bank with the best stored clue, cleaned, and saves a draft", async () => {
    const f = fakeDb();
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    const p = r.puzzle;
    expect(r.source).toBe("bank");
    expect(p).toMatchObject({ status: "ready", source: "bank", title: GENERAL_TITLE, plays: [] });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.entries.length).toBeGreaterThanOrEqual(10);
    for (const e of p.entries) {
      // The seed clue, its "(N)" stripped; never the leaky one.
      expect(e.clue).toBe(CROSSWORD_SEED_WORDS.find((w) => w.answer === e.answer)!.clue);
      expect(validateClue(e.clue, e.answer)).toBeNull();
      expect(r.clueVia[e.answer]).toBe("stored");
    }
    expect(f.upsert).toHaveBeenCalledWith(p);
    expect(f.forBuild).toHaveBeenCalledTimes(1);
  });

  it("uses an operator-approved clue first, as written", async () => {
    const f = fakeDb({
      clues: (w) => [clue(`${w.id}c1`, w.clue), clue(`${w.id}c2`, `Operator says: word ${w.id}`, "approved")],
    });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    for (const e of r.puzzle.entries) {
      expect(e.clue).toMatch(/^Operator says: word b\d+$/);
      expect(r.clueVia[e.answer]).toBe("approved");
    }
  });

  it("is repeatable for a seed", async () => {
    const a = await buildPuzzle(fakeDb().db, { sceneId: "xw", seed: 11 }, FAST);
    const b = await buildPuzzle(fakeDb().db, { sceneId: "xw", seed: 11 }, FAST);
    expect(b.puzzle.entries).toEqual(a.puzzle.entries);
  });

  it("is ready, and stores nothing on a dry run", async () => {
    const f = fakeDb();
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, { ...FAST, dryRun: true });
    expect(r.puzzle).toMatchObject({ status: "ready", title: GENERAL_TITLE });
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("builds from the seed set when the bank is empty", async () => {
    const f = fakeDb({ bank: [] });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    expect(r.puzzle).toMatchObject({ source: "seed", title: "Space", familyFriendly: true });
    expect(Object.values(r.clueVia).every((v) => v === "seed")).toBe(true);
    expect(f.forBuild).not.toHaveBeenCalled();
  });

  it("drops a placed word with no usable clue and lays out again without it", async () => {
    const bad = new Set(["MARS", "COMET", "ORBIT", "PLANET", "GALAXY", "NEBULA"]);
    const f = fakeDb({ clues: (w) => (bad.has(w.norm) ? [clue("x", "Short"), clue("y", `The ${w.norm} one`)] : [clue("z", w.clue)]) });
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST);
    expect(r.puzzle.entries.length).toBeGreaterThanOrEqual(10);
    expect(r.puzzle.entries.some((e) => bad.has(e.answer))).toBe(false);
    expect(r.dropped.length).toBeGreaterThan(0);
    for (const d of r.dropped) expect(bad.has(d)).toBe(true);
  });

  it("fails with too few survivors", async () => {
    const good = new Set(WORDS.slice(0, 8).map((w) => w.norm));
    const f = fakeDb({ clues: (w) => (good.has(w.norm) ? [clue("z", w.clue)] : []) });
    await expect(buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST)).rejects.toBeInstanceOf(CrosswordBuildError);
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it("fails when the layout cannot reach minWords", async () => {
    const f = fakeDb({ bank: WORDS.slice(0, 12), cfg: { minWords: 12 } });
    await expect(buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, FAST)).rejects.toThrow(/layout placed/);
  });

  it("offers the polish seam the unapproved words once, and validates what comes back", async () => {
    const f = fakeDb();
    const polish = jest.fn(async (words: { answer: string; candidates: string[] }[]) => ({
      model: "test-model",
      clues: new Map(words.map((w, i) => [w.answer, i === 0 ? `Plainly ${w.answer}` : `Polished clue number ${i}`])),
    }));
    const r = await buildPuzzle(f.db, { sceneId: "xw", seed: 3 }, { ...FAST, polish });
    expect(polish).toHaveBeenCalledTimes(1);
    const offered = polish.mock.calls[0][0];
    expect(offered[0].candidates[0]).not.toMatch(/\(\d+\)$/);
    const vias = Object.values(r.clueVia);
    expect(vias.filter((v) => v === "polish").length).toBe(r.puzzle.entries.length - 1);
    // The leaking one fell back to the stored clue.
    expect(r.clueVia[offered[0].answer]).toBe("stored");
  });
});

describe("clue ranking", () => {
  it("ranks usable stored candidates nearest the target length, skipping approved and rejected", () => {
    const ranked = rankStoredClues(
      [
        clue("a", "Big ball of gas (4)"),
        clue("b", "Fiery ball that lights up our solar system"),
        clue("c", "Ok"),
        clue("d", "The star of the sun show"),
        clue("e", "Our nearest star, seen by day", "rejected"),
        clue("f", "Star at the centre of things", "approved"),
        clue("g", "Big ball of gas"),
      ],
      "SUN",
    );
    expect(ranked).toEqual(["Fiery ball that lights up our solar system", "Big ball of gas"]);
  });

  it("honours the scene's blocklist", () => {
    expect(rankStoredClues([clue("a", "A rather nasty word here")], "SUN", ["nasty"])).toEqual([]);
    expect(approvedClue([clue("a", "A rather nasty word here", "approved")], "SUN", ["nasty"])).toBeNull();
    expect(approvedClue([clue("a", "A rather fine word here", "approved")], "SUN")).toBe("A rather fine word here");
  });
});

describe("topUpScenes", () => {
  const ready = (id: string, playedOn: string[] = []) => ({
    id,
    status: "ready",
    entries: [{}],
    plays: playedOn.map((sceneId) => ({ sceneId, startedAt: 1 })),
  });

  it("builds one puzzle for an enabled scene short of stock, and skips the rest", async () => {
    const f = fakeDb({ scenes: ["xw"], cfg: { enabled: true, stockTarget: 2 }, ready: [ready("p1")] });
    const out = await topUpScenes(f.db, FAST);
    expect(out).toEqual([expect.objectContaining({ sceneId: "xw", outcome: "built", status: "ready" })]);
    expect(f.upsert).toHaveBeenCalledTimes(1);

    const stocked = fakeDb({ scenes: ["xw"], cfg: { enabled: true, stockTarget: 1 }, ready: [ready("p1")] });
    expect(await topUpScenes(stocked.db, FAST)).toEqual([{ sceneId: "xw", outcome: "stocked" }]);

    const off = fakeDb({ scenes: ["xw"], cfg: { enabled: false } });
    expect(await topUpScenes(off.db, FAST)).toEqual([{ sceneId: "xw", outcome: "disabled" }]);
    expect(off.upsert).not.toHaveBeenCalled();
  });

  it("counts a puzzle the scene already played as spent", async () => {
    const f = fakeDb({ scenes: ["xw"], cfg: { enabled: true, stockTarget: 1 }, ready: [ready("p1", ["xw"])] });
    expect((await topUpScenes(f.db, FAST))[0].outcome).toBe("built");
  });

  it("reports a failed build and carries on", async () => {
    const f = fakeDb({ scenes: ["a", "b"], cfg: { enabled: true, minWords: 30 } });
    const out = await topUpScenes(f.db, FAST);
    expect(out.map((o) => o.outcome)).toEqual(["failed", "failed"]);
  });
});

describe("indexBank", () => {
  it("builds the bank indexes and is safe to re-run", async () => {
    const f = fakeDb();
    const a = await indexBank(f.db);
    const b = await indexBank(f.db);
    expect(a).toEqual({ indexes: ["xwbank_norm_ix", "xwbank_answer_ix"] });
    expect(b).toEqual(a);
    expect(f.ensureIndexes).toHaveBeenCalledTimes(2);
  });
});

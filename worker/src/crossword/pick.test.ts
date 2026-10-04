import { DEFAULT_CROSSWORD_CONFIG } from "@photonsurge/shared/crossword";
import { CROSSWORD_SEED_WORDS } from "@photonsurge/shared/crossword-seeds";
import { pickCandidates, spreadByLength } from "./pick";
import { seededRng } from "./layout";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** 200 distinct fake words, 3–12 letters, zipf 2.0–5.9. */
const BANK = Array.from({ length: 200 }, (_, i) => {
  const len = 3 + (i % 10);
  // Two-letter unique prefix, padded.
  let s = LETTERS[Math.floor(i / 26)] + LETTERS[i % 26];
  for (let k = 2; k < len; k++) s += LETTERS[(i * 7 + k * 3) % 26];
  return {
    id: `w${i}`,
    norm: s,
    length: len,
    zipf: 2 + (i % 40) / 10,
    familyFriendly: true as boolean | null,
    clues: [{ id: `w${i}c1`, text: `Approved clue for word ${i}`, familyFriendly: true as boolean | null }],
  };
});

function fakeDb(opts: { bank?: typeof BANK; recent?: string[][]; imported?: number } = {}) {
  const playable = jest.fn(async (_q: any) => opts.bank ?? BANK);
  const words = { estimatedDocumentCount: jest.fn(async () => opts.imported ?? (opts.bank ?? BANK).length) };
  const recentForScene = jest.fn(async (_s: string, _n: number) =>
    (opts.recent ?? []).map((answers, i) => ({ id: `p${i}`, entries: answers.map((answer) => ({ answer })) })),
  );
  return { db: { crosswordBank: { playable, words: () => words }, crosswordPuzzles: { recentForScene } } as any, playable, recentForScene };
}

const cfg = { ...DEFAULT_CROSSWORD_CONFIG };
const opt = (o: { seed: number; count?: number }) => ({ allowUnapproved: false, ...o });

describe("pickCandidates", () => {
  it("asks the bank for playable words at the scene's minZipf, and drops any below it", async () => {
    const f = fakeDb();
    const pick = await pickCandidates(f.db, "xw", { ...cfg, minZipf: 4 }, opt({ seed: 1 }));
    expect(f.playable).toHaveBeenCalledWith(
      expect.objectContaining({ minZipf: 4, minLength: 3, maxLength: 12, familyFriendlyOnly: true, allowUnapproved: false }),
    );
    expect(pick.source).toBe("bank");
    expect(pick.words).toHaveLength(60);
    for (const w of pick.words) {
      expect(w.zipf).toBeGreaterThanOrEqual(4);
      expect(w.wordId).toMatch(/^w\d+$/);
      expect(w.clues.length).toBeGreaterThan(0);
      expect(w.answer).toMatch(/^[A-Z]{3,12}$/);
    }
  });

  it("caps lengths at the grid size", async () => {
    const f = fakeDb();
    const pick = await pickCandidates(f.db, "xw", { ...cfg, maxSize: 9 }, opt({ seed: 1 }));
    expect(f.playable).toHaveBeenCalledWith(expect.objectContaining({ maxLength: 9 }));
    expect(Math.max(...pick.words.map((w) => w.answer.length))).toBeLessThanOrEqual(9);
  });

  it("leaves out words from the scene's last noRepeatWordsPuzzles puzzles", async () => {
    const used = BANK.slice(0, 30).map((w) => w.norm);
    const f = fakeDb({ recent: [used.slice(0, 15), used.slice(15)] });
    const pick = await pickCandidates(f.db, "xw", { ...cfg, minZipf: 0, noRepeatWordsPuzzles: 20 }, opt({ seed: 1, count: 200 }));
    expect(f.recentForScene).toHaveBeenCalledWith("xw", 20);
    const q = f.playable.mock.calls[0][0];
    for (const u of used) expect(q.excludeNorms).toContain(u);
    expect(pick.words.some((w) => used.includes(w.answer))).toBe(false);
    expect(pick.excluded).toBe(30);
  });

  it("drops multi-word entries and duplicates", async () => {
    const bank = [...BANK, { ...BANK[1], id: "x1", norm: "ice cream", length: 9, zipf: 5 }, { ...BANK[1], id: "x2", norm: BANK[0].norm.toLowerCase(), length: 3, zipf: 5 }];
    const pick = await pickCandidates(fakeDb({ bank }).db, "xw", { ...cfg, minZipf: 0 }, opt({ seed: 1, count: 500 }));
    expect(pick.words.some((w) => w.wordId === "x1")).toBe(false);
    expect(pick.words.filter((w) => w.answer === BANK[0].norm)).toHaveLength(1);
  });

  it("is repeatable for a seed, whatever order the bank returns", async () => {
    const a = await pickCandidates(fakeDb().db, "xw", cfg, opt({ seed: 5 }));
    const b = await pickCandidates(fakeDb({ bank: [...BANK].reverse() }).db, "xw", cfg, opt({ seed: 5 }));
    const c = await pickCandidates(fakeDb().db, "xw", cfg, opt({ seed: 6 }));
    expect(b.words).toEqual(a.words);
    expect(c.words).not.toEqual(a.words);
  });

  it("spreads lengths, favouring the middle", async () => {
    const pick = await pickCandidates(fakeDb().db, "xw", { ...cfg, minZipf: 0 }, opt({ seed: 1, count: 40 }));
    const lens = new Set(pick.words.map((w) => w.answer.length));
    expect(lens.size).toBeGreaterThanOrEqual(8);
    const mid = pick.words.filter((w) => w.answer.length >= 5 && w.answer.length <= 8).length;
    expect(mid).toBeGreaterThan(pick.words.length / 3);
  });

  it("passes the channel's family-friendly switch and the dev switch, and checks the tags itself", async () => {
    const bank = BANK.map((w, i) => ({
      ...w,
      familyFriendly: i % 2 ? true : null,
      clues: [{ ...w.clues[0], familyFriendly: i % 4 === 1 ? null : true }],
    }));
    const f = fakeDb({ bank });
    const pick = await pickCandidates(f.db, "xw", { ...cfg, minZipf: 0 }, opt({ seed: 1, count: 500 }));
    expect(pick.words.length).toBe(BANK.filter((_, i) => i % 4 === 3).length);
    const off = await pickCandidates(fakeDb({ bank }).db, "xw", { ...cfg, minZipf: 0, familyFriendlyOnly: false }, opt({ seed: 1, count: 500 }));
    expect(off.words.length).toBe(BANK.length);
    const g = fakeDb({ bank });
    const dev = await pickCandidates(g.db, "xw", { ...cfg, minZipf: 0 }, { seed: 1, count: 500, allowUnapproved: true });
    expect(g.playable).toHaveBeenCalledWith(expect.objectContaining({ allowUnapproved: true }));
    expect(dev).toMatchObject({ unapproved: true });
    expect(dev.words.length).toBe(BANK.length);
  });

  it("keeps only clues that pass validateClue, and drops a word left with none", async () => {
    const bank = BANK.map((w, i) => ({
      ...w,
      clues: i < 10 ? [{ id: `${w.id}x`, text: "Tiny", familyFriendly: true }] : [...w.clues, { id: `${w.id}y`, text: "ok", familyFriendly: true }],
    }));
    const pick = await pickCandidates(fakeDb({ bank }).db, "xw", { ...cfg, minZipf: 0 }, opt({ seed: 1, count: 500 }));
    expect(pick.available).toBe(BANK.length - 10);
    for (const w of pick.words) expect(w.clues.map((c) => c.id)).toEqual([`${w.wordId}c1`]);
  });

  it("uses the seed set only when no bank is imported", async () => {
    const f = fakeDb({ bank: [], recent: [["COMET", "ORBIT"]] });
    const pick = await pickCandidates(f.db, "xw", cfg, opt({ seed: 1 }));
    expect(pick.source).toBe("seed");
    // The whole seed set (no no-repeat window on it), each approved and family friendly with seed ids.
    expect(pick.words).toHaveLength(CROSSWORD_SEED_WORDS.length);
    for (const w of pick.words) {
      expect(w.wordId).toMatch(/^seed:/);
      expect(w.familyFriendly).toBe(true);
      expect(w.clues).toEqual([expect.objectContaining({ id: expect.stringMatching(/^seed:/), familyFriendly: true })]);
    }
    expect(pick.words.map((w) => w.answer)).toContain("ORBIT");

    const thin = await pickCandidates(fakeDb({ bank: BANK.slice(0, 5) }).db, "xw", { ...cfg, minZipf: 0 }, opt({ seed: 1 }));
    expect(thin).toMatchObject({ source: "bank", available: 5 });
    const unapproved = await pickCandidates(fakeDb({ bank: [], imported: 9 }).db, "xw", cfg, opt({ seed: 1 }));
    expect(unapproved).toMatchObject({ source: "bank", available: 0, words: [] });
  });
});

describe("spreadByLength", () => {
  it("never repeats or invents a word", () => {
    const words = BANK.map((w) => ({ answer: w.norm }));
    const out = spreadByLength(words, 500, seededRng(1));
    expect(out).toHaveLength(words.length);
    expect(new Set(out.map((w) => w.answer)).size).toBe(words.length);
  });
});

import { DEFAULT_CROSSWORD_CONFIG } from "@photonsurge/shared/crossword";
import { CROSSWORD_SEED_THEME, CROSSWORD_SEED_WORDS } from "@photonsurge/shared/crossword-seeds";
import { pickCandidates, spreadByLength } from "./pick";
import { seededRng } from "./layout";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** 200 distinct fake words, 3–12 letters, zipf 2.0–5.9. */
const BANK = Array.from({ length: 200 }, (_, i) => {
  const len = 3 + (i % 10);
  // Two-letter unique prefix, padded.
  let s = LETTERS[Math.floor(i / 26)] + LETTERS[i % 26];
  for (let k = 2; k < len; k++) s += LETTERS[(i * 7 + k * 3) % 26];
  return { id: `w${i}`, norm: s, length: len, zipf: 2 + (i % 40) / 10 };
});

function fakeDb(opts: { bank?: typeof BANK; recent?: string[][] } = {}) {
  const playable = jest.fn(async (_q: any) => opts.bank ?? BANK);
  const recentForScene = jest.fn(async (_s: string, _n: number) =>
    (opts.recent ?? []).map((answers, i) => ({ id: `p${i}`, entries: answers.map((answer) => ({ answer })) })),
  );
  return { db: { crosswordBank: { playable }, crosswordPuzzles: { recentForScene } } as any, playable, recentForScene };
}

const cfg = { ...DEFAULT_CROSSWORD_CONFIG };

describe("pickCandidates", () => {
  it("asks the bank for playable words at the scene's minZipf, and drops any below it", async () => {
    const f = fakeDb();
    const pick = await pickCandidates(f.db, "xw", { ...cfg, minZipf: 4 }, { seed: 1 });
    expect(f.playable).toHaveBeenCalledWith(expect.objectContaining({ minZipf: 4, minLength: 3, maxLength: 12 }));
    expect(pick.source).toBe("bank");
    expect(pick.words).toHaveLength(60);
    for (const w of pick.words) {
      expect(w.zipf).toBeGreaterThanOrEqual(4);
      expect(w.bankId).toMatch(/^w\d+$/);
      expect(w.answer).toMatch(/^[A-Z]{3,12}$/);
    }
  });

  it("caps lengths at the grid size", async () => {
    const f = fakeDb();
    const pick = await pickCandidates(f.db, "xw", { ...cfg, maxSize: 9 }, { seed: 1 });
    expect(f.playable).toHaveBeenCalledWith(expect.objectContaining({ maxLength: 9 }));
    expect(Math.max(...pick.words.map((w) => w.answer.length))).toBeLessThanOrEqual(9);
  });

  it("leaves out words from the scene's last noRepeatWordsPuzzles puzzles", async () => {
    const used = BANK.slice(0, 30).map((w) => w.norm);
    const f = fakeDb({ recent: [used.slice(0, 15), used.slice(15)] });
    const pick = await pickCandidates(f.db, "xw", { ...cfg, minZipf: 0, noRepeatWordsPuzzles: 20 }, { seed: 1, count: 200 });
    expect(f.recentForScene).toHaveBeenCalledWith("xw", 20);
    const q = f.playable.mock.calls[0][0];
    for (const u of used) expect(q.excludeNorms).toContain(u);
    expect(pick.words.some((w) => used.includes(w.answer))).toBe(false);
    expect(pick.excluded).toBe(30);
  });

  it("drops multi-word entries and duplicates", async () => {
    const bank = [...BANK, { id: "x1", norm: "ice cream", length: 9, zipf: 5 }, { id: "x2", norm: BANK[0].norm.toLowerCase(), length: 3, zipf: 5 }];
    const pick = await pickCandidates(fakeDb({ bank }).db, "xw", { ...cfg, minZipf: 0 }, { seed: 1, count: 500 });
    expect(pick.words.some((w) => w.bankId === "x1")).toBe(false);
    expect(pick.words.filter((w) => w.answer === BANK[0].norm)).toHaveLength(1);
  });

  it("is repeatable for a seed, whatever order the bank returns", async () => {
    const a = await pickCandidates(fakeDb().db, "xw", cfg, { seed: 5 });
    const b = await pickCandidates(fakeDb({ bank: [...BANK].reverse() }).db, "xw", cfg, { seed: 5 });
    const c = await pickCandidates(fakeDb().db, "xw", cfg, { seed: 6 });
    expect(b.words).toEqual(a.words);
    expect(c.words).not.toEqual(a.words);
  });

  it("spreads lengths, favouring the middle", async () => {
    const pick = await pickCandidates(fakeDb().db, "xw", { ...cfg, minZipf: 0 }, { seed: 1, count: 40 });
    const lens = new Set(pick.words.map((w) => w.answer.length));
    expect(lens.size).toBeGreaterThanOrEqual(8);
    const mid = pick.words.filter((w) => w.answer.length >= 5 && w.answer.length <= 8).length;
    expect(mid).toBeGreaterThan(pick.words.length / 3);
  });

  it("falls back to the seed set when the bank is empty or too thin", async () => {
    for (const bank of [[], BANK.slice(0, 5)]) {
      const f = fakeDb({ bank, recent: [["COMET", "ORBIT"]] });
      const pick = await pickCandidates(f.db, "xw", cfg, { seed: 1 });
      expect(pick.source).toBe("seed");
      expect(pick.theme).toBe(CROSSWORD_SEED_THEME);
      // The whole seed set (no no-repeat window on it), each with its clue.
      expect(pick.words).toHaveLength(CROSSWORD_SEED_WORDS.length);
      expect(pick.words.every((w) => !w.bankId && w.clue)).toBe(true);
      expect(pick.words.map((w) => w.answer)).toContain("ORBIT");
    }
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

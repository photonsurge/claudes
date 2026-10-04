import { CROSSWORD_SEED_WORDS } from "@photonsurge/shared/crossword-seeds";
import { cellKey, entryCells, type CrosswordEntry } from "@photonsurge/shared/crossword";
import { CrosswordLayoutError, layoutAttempt, layoutCrossword, seededRng } from "./layout";

const SEED = CROSSWORD_SEED_WORDS.map((w) => ({ answer: w.answer, clue: w.clue }));
const OPTS = { minWords: 10, maxWords: 16, maxSize: 13, maxAttempts: 40, budgetMs: 1e9 };

/**
 * The criss-cross rules, checked from the finished grid: every maximal run of
 * two or more letters in a row is exactly one across entry (and in a column one
 * down entry) — so no side-by-side touching and no end-to-end run-ons — every
 * entry crosses another, and every cell is in the box.
 */
function checkGrid(entries: CrosswordEntry[], width: number, height: number) {
  const letters = new Map<string, string>();
  for (const e of entries) {
    entryCells(e).forEach((c, i) => {
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.col).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeLessThan(height);
      expect(c.col).toBeLessThan(width);
      const k = cellKey(c.row, c.col);
      if (letters.has(k)) expect(letters.get(k)).toBe(e.answer[i]);
      letters.set(k, e.answer[i]);
    });
  }
  const runs = (dir: "across" | "down") => {
    const out: string[] = [];
    const [outer, inner] = dir === "across" ? [height, width] : [width, height];
    for (let a = 0; a < outer; a++) {
      let start = -1;
      for (let b = 0; b <= inner; b++) {
        const [r, c] = dir === "across" ? [a, b] : [b, a];
        const filled = b < inner && letters.has(cellKey(r, c));
        if (filled && start < 0) start = b;
        if (!filled && start >= 0) {
          if (b - start >= 2) out.push(dir === "across" ? `${a},${start},${b - start}` : `${start},${a},${b - start}`);
          start = -1;
        }
      }
    }
    return out.sort();
  };
  for (const dir of ["across", "down"] as const) {
    const want = entries
      .filter((e) => e.dir === dir)
      .map((e) => `${e.row},${e.col},${e.answer.length}`)
      .sort();
    expect(runs(dir)).toEqual(want);
  }
  // Every entry crosses at least one other.
  for (const e of entries) {
    const mine = new Set(entryCells(e).map((c) => cellKey(c.row, c.col)));
    const crossed = entries.some((o) => o !== e && entryCells(o).some((c) => mine.has(cellKey(c.row, c.col))));
    expect(crossed).toBe(true);
  }
}

describe("layoutCrossword", () => {
  it("places the seed set: at least 10 words, criss-cross rules hold, 0-origin box", async () => {
    const r = await layoutCrossword(SEED, { ...OPTS, seed: 1 });
    expect(r.entries.length).toBeGreaterThanOrEqual(10);
    expect(r.entries.length).toBeLessThanOrEqual(16);
    expect(r.width).toBeLessThanOrEqual(13);
    expect(r.height).toBeLessThanOrEqual(13);
    expect(Math.min(...r.placements.map((p) => p.row))).toBe(0);
    expect(Math.min(...r.placements.map((p) => p.col))).toBe(0);
    expect(r.crossings).toBeGreaterThanOrEqual(r.entries.length - 1);
    checkGrid(r.entries, r.width, r.height);
    // Clues ride through; numbering is standard (ids match num + dir).
    for (const e of r.entries) {
      expect(e.clue).toBe(SEED.find((w) => w.answer === e.answer)!.clue);
      expect(e.id).toBe(`${e.num}${e.dir === "across" ? "A" : "D"}`);
    }
  });

  it("holds the rules across many seeds", async () => {
    for (let seed = 2; seed < 12; seed++) {
      const r = await layoutCrossword(SEED, { ...OPTS, maxAttempts: 5, seed });
      checkGrid(r.entries, r.width, r.height);
    }
  });

  it("is deterministic for a seed, whatever the clock does", async () => {
    let t = 0;
    const a = await layoutCrossword(SEED, { ...OPTS, seed: 7 });
    const b = await layoutCrossword(SEED, { ...OPTS, seed: 7, now: () => (t += 1) });
    expect(b.entries).toEqual(a.entries);
    expect([b.width, b.height, b.attempts]).toEqual([a.width, a.height, a.attempts]);
    const c = await layoutCrossword(SEED, { ...OPTS, seed: 8 });
    expect(c.entries).not.toEqual(a.entries);
  });

  it("yields to the event loop between attempts", async () => {
    // A chain of setImmediate callbacks only advances while the layout lets go.
    let ticks = 0;
    let running = true;
    const tick = () => setImmediate(() => running && (ticks++, tick()));
    tick();
    await layoutCrossword(SEED, { ...OPTS, seed: 3, maxAttempts: 20 });
    running = false;
    expect(ticks).toBeGreaterThanOrEqual(10);
  });

  it("stops at the time budget", async () => {
    let t = 0;
    const r = await layoutCrossword(SEED, { ...OPTS, seed: 1, maxAttempts: 1000, budgetMs: 5, now: () => (t += 1) });
    expect(r.attempts).toBeLessThan(10);
  });

  it("fails below minWords", async () => {
    const few = SEED.slice(0, 6);
    await expect(layoutCrossword(few, { ...OPTS, seed: 1 })).rejects.toBeInstanceOf(CrosswordLayoutError);
    // Words that share no letters cannot cross at all.
    await expect(
      layoutCrossword([{ answer: "AAA" }, { answer: "BBB" }, { answer: "CCC" }, { answer: "DDD" }], { ...OPTS, minWords: 4, seed: 1 }),
    ).rejects.toThrow(/placed 1 of 4/);
  });

  it("keeps a single attempt well under 20 ms on a 60-word list", () => {
    const extra = "WEATHER STORM THUNDER CLOUD RAINBOW SNOWFALL BREEZE TORNADO HURRICANE DRIZZLE FROST SLEET MONSOON CYCLONE HAIL FOG MIST COMET CRATER TITAN LUNAR SOLAR AURORA CORONA"
      .split(" ")
      .map((answer) => ({ answer }));
    const words = [...SEED, ...extra].slice(0, 60);
    expect(words).toHaveLength(60);
    for (let i = 0; i < 20; i++) layoutAttempt(words, seededRng(i), { maxWords: 16, maxSize: 13 }); // warm up
    const n = 100;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) layoutAttempt(words, seededRng(1000 + i), { maxWords: 16, maxSize: 13 });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
    // §7.1: over 20 ms an attempt and the search moves to the bake pool. Loose
    // bound so a slow CI box does not flake; measured ~4 ms on a dev box.
    expect(ms).toBeLessThan(20);
  });
});

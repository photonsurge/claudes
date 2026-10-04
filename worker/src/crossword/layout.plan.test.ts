/**
 * Plan-written tests for the layout search (docs/crossword-mode-plan.md §7.1,
 * §12 worker): places the seed set, deterministic for a seed, criss-cross
 * (every word crosses another, nothing touches side by side or end to end),
 * within maxSize, standard numbering, fails below minWords, and yields to the
 * event loop. No wall-clock thresholds: attempts are capped and the budget is
 * made unreachable, so the result does not depend on machine load.
 */
import { normalizeAnswer, type CrosswordPlacement } from "@photonsurge/shared/crossword";
import { CROSSWORD_SEED_WORDS } from "@photonsurge/shared/crossword-seeds";
import { CrosswordLayoutError, layoutCrossword } from "./layout";

const SEED = CROSSWORD_SEED_WORDS.map((w) => ({ answer: normalizeAnswer(w.answer), clue: w.clue }));
const OPTS = { minWords: 10, maxWords: 16, maxSize: 13, maxAttempts: 12, budgetMs: 1e12 };

type Cell = { letter: string; across?: number; down?: number };

function cellsOf(p: CrosswordPlacement): [number, number][] {
  return [...p.answer].map((_, i) => (p.dir === "across" ? [p.row, p.col + i] : [p.row + i, p.col]));
}

/** Grid map; throws on a clash (two letters in one cell, or two words of one direction sharing a cell). */
function gridOf(placements: CrosswordPlacement[]): Map<string, Cell> {
  const g = new Map<string, Cell>();
  placements.forEach((p, idx) => {
    cellsOf(p).forEach(([r, c], i) => {
      const k = `${r},${c}`;
      const cell = g.get(k) ?? { letter: p.answer[i] };
      if (cell.letter !== p.answer[i]) throw new Error(`letter clash at ${k}`);
      if (cell[p.dir] !== undefined) throw new Error(`two ${p.dir} words share ${k}`);
      cell[p.dir] = idx;
      g.set(k, cell);
    });
  });
  return g;
}

/** Every criss-cross rule the plan names; returns the problems found. */
function crissCrossProblems(placements: CrosswordPlacement[]): string[] {
  const problems: string[] = [];
  let g: Map<string, Cell>;
  try {
    g = gridOf(placements);
  } catch (e) {
    return [(e as Error).message];
  }
  const has = (r: number, c: number) => g.has(`${r},${c}`);
  placements.forEach((p, idx) => {
    const cells = cellsOf(p);
    const other = p.dir === "across" ? "down" : "across";
    const crossings = cells.filter(([r, c]) => g.get(`${r},${c}`)![other] !== undefined).length;
    if (crossings === 0) problems.push(`${p.answer} crosses nothing`);
    // Nothing directly before the start or after the end (no run-on).
    const [r0, c0] = cells[0];
    const [r1, c1] = cells[cells.length - 1];
    if (p.dir === "across" ? has(r0, c0 - 1) || has(r1, c1 + 1) : has(r0 - 1, c0) || has(r1 + 1, c1)) {
      problems.push(`${p.answer} runs on into another word`);
    }
    // Side by side: a cell that is not a crossing has empty neighbours across the word's line.
    for (const [r, c] of cells) {
      if (g.get(`${r},${c}`)![other] !== undefined) continue;
      const side = p.dir === "across" ? has(r - 1, c) || has(r + 1, c) : has(r, c - 1) || has(r, c + 1);
      if (side) problems.push(`${p.answer} (#${idx}) touches another word side by side at ${r},${c}`);
    }
  });
  return problems;
}

describe("layoutCrossword (plan §7.1)", () => {
  it("places the seed set: at least minWords (10), at most maxWords", async () => {
    const r = await layoutCrossword(SEED, { ...OPTS, seed: 1 });
    expect(r.placements.length).toBeGreaterThanOrEqual(10);
    expect(r.placements.length).toBeLessThanOrEqual(OPTS.maxWords);
    expect(r.entries).toHaveLength(r.placements.length);
    // Only words it was given, each at most once.
    const given = new Set(SEED.map((w) => w.answer));
    const answers = r.placements.map((p) => p.answer);
    for (const a of answers) expect(given.has(a)).toBe(true);
    expect(new Set(answers).size).toBe(answers.length);
  });

  it.each([1, 7, 42, 2024, 99991])("is criss-cross for seed %i: every word crosses another, none touch side by side", async (seed) => {
    const r = await layoutCrossword(SEED, { ...OPTS, seed });
    expect(crissCrossProblems(r.placements)).toEqual([]);
  });

  it.each([
    [8, 4],
    [11, 10],
    [13, 10],
  ])("stays within maxSize %i (minWords %i) and inside its stated box", async (maxSize, minWords) => {
    const r = await layoutCrossword(SEED, { ...OPTS, maxSize, minWords, seed: 5 });
    expect(r.width).toBeLessThanOrEqual(maxSize);
    expect(r.height).toBeLessThanOrEqual(maxSize);
    for (const p of r.placements) {
      for (const [row, col] of cellsOf(p)) {
        expect(row).toBeGreaterThanOrEqual(0);
        expect(col).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(r.height);
        expect(col).toBeLessThan(r.width);
      }
    }
  });

  it("is deterministic for a seed (same words, same options, same grid)", async () => {
    const a = await layoutCrossword(SEED, { ...OPTS, seed: 31337 });
    const b = await layoutCrossword(SEED, { ...OPTS, seed: 31337 });
    expect(b.placements).toEqual(a.placements);
    expect(b.entries).toEqual(a.entries);
    expect([b.width, b.height, b.crossings]).toEqual([a.width, a.height, a.crossings]);
  });

  it("does not depend on the clock for a seed", async () => {
    let t = 0;
    const slowClock = () => (t += 1000); // a clock that races ahead, but the budget is out of reach
    const a = await layoutCrossword(SEED, { ...OPTS, seed: 8, now: slowClock });
    const b = await layoutCrossword(SEED, { ...OPTS, seed: 8 });
    expect(a.placements).toEqual(b.placements);
  });

  it("lays out a reordered list legally too", async () => {
    const r = await layoutCrossword([...SEED].reverse(), { ...OPTS, seed: 3 });
    expect(r.placements.length).toBeGreaterThanOrEqual(10);
    expect(crissCrossProblems(r.placements)).toEqual([]);
  });

  it("numbers in standard row order: a start cell gets one number, numbers rise left to right, top to bottom", async () => {
    const r = await layoutCrossword(SEED, { ...OPTS, seed: 11 });
    const starts = new Map<string, number>();
    for (const e of r.entries) {
      const k = `${e.row},${e.col}`;
      if (starts.has(k)) expect(starts.get(k)).toBe(e.num);
      starts.set(k, e.num);
      expect(e.id).toBe(`${e.num}${e.dir === "across" ? "A" : "D"}`);
    }
    const ordered = [...starts.entries()]
      .map(([k, n]) => ({ r: Number(k.split(",")[0]), c: Number(k.split(",")[1]), n }))
      .sort((a, b) => a.r - b.r || a.c - b.c);
    expect(ordered.map((s) => s.n)).toEqual(ordered.map((_, i) => i + 1));
  });

  it("fails below minWords (10) with a layout error", async () => {
    const few = SEED.slice(0, 6);
    await expect(layoutCrossword(few, { ...OPTS, seed: 1 })).rejects.toBeInstanceOf(CrosswordLayoutError);
  });

  it("yields to the event loop between attempts", async () => {
    let ticks = 0;
    let done = false;
    const tick = () => {
      if (done) return;
      ticks++;
      setImmediate(tick);
    };
    setImmediate(tick);
    const p = layoutCrossword(SEED, { ...OPTS, maxAttempts: 6, seed: 2 });
    // A timer queued now must run before the layout finishes.
    let timerRan = false;
    setTimeout(() => (timerRan = true), 0);
    const r = await p;
    done = true;
    expect(r.attempts).toBe(6);
    expect(ticks).toBeGreaterThanOrEqual(3);
    expect(timerRan).toBe(true);
  });
});

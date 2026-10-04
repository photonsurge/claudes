/**
 * Crossword layout search (docs/crossword-mode-plan.md §7.1).
 *
 * Criss-cross style: every word crosses at least one other, no word touches
 * another side by side, and no word runs on into another end to end. A dense
 * newspaper fill is not attempted.
 *
 * The search is seeded random restarts. One attempt grows a grid greedily:
 * start from a longish word, then repeatedly place the candidate whose best
 * legal position scores highest (most crossings, smallest near-square box),
 * sweeping the remaining words again whenever the grid grows, until nothing
 * else fits or `maxWords` is reached. Each attempt gets its own RNG derived
 * from (seed, attempt number), so a result depends only on the seed and how
 * many attempts ran — never on the clock — and the best attempt by (words
 * placed, crossings, compactness) wins. The search yields to the event loop
 * between attempts so the worker's timers keep running.
 *
 * Written fresh: the February prototype's "backtracking" skipped a word that
 * did not fit and still reported success. Here a word that does not fit is
 * simply retried on the next sweep, and the restarts do the exploring.
 */
import { cellKey, numberEntries, type CrosswordDir, type CrosswordEntry, type CrosswordPlacement } from "@photonsurge/shared/crossword";

export interface LayoutWord {
  /** A–Z only (normalised by the caller). */
  answer: string;
  /** Carried through to the placement; the builder fills it later if empty. */
  clue?: string;
}

export interface LayoutOptions {
  seed: number;
  /** Below this many placed words the layout fails. */
  minWords: number;
  /** Stop placing at this many words. */
  maxWords: number;
  /** Largest grid side, in cells. */
  maxSize: number;
  /** Wall-clock backstop for the restarts. Default 3000 ms. */
  budgetMs?: number;
  /**
   * Cap on attempts. Default 150 (about 0.6 s on a dev box), well inside the
   * budget, so normally the cap decides and a seed always gives the same grid.
   */
  maxAttempts?: number;
  now?: () => number;
}

export interface LayoutResult {
  /** Normalised to a 0-origin box. */
  placements: CrosswordPlacement[];
  entries: CrosswordEntry[];
  width: number;
  height: number;
  crossings: number;
  attempts: number;
}

/** The layout could not place `minWords` words. */
export class CrosswordLayoutError extends Error {
  constructor(
    message: string,
    readonly best: number,
  ) {
    super(message);
    this.name = "CrosswordLayoutError";
  }
}

const DEFAULT_BUDGET_MS = 3000;
const DEFAULT_MAX_ATTEMPTS = 150;
/** Words looked at per greedy step (the rest wait for the next step). */
const LOOKAHEAD = 14;

/** mulberry32: small, fast, good enough for shuffles. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates on a copy. */
export function shuffled<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Cell {
  letter: string;
  across: boolean;
  down: boolean;
}

interface Attempt {
  placements: CrosswordPlacement[];
  crossings: number;
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

interface Candidate {
  row: number;
  col: number;
  dir: CrosswordDir;
  crossings: number;
  score: number;
}

const step = (dir: CrosswordDir) => (dir === "across" ? [0, 1] : [1, 0]);

/** Smaller is better: area plus a penalty for a long thin box. */
const boxCost = (h: number, w: number) => h * w + 3 * Math.abs(h - w);

class Grid {
  cells = new Map<string, Cell>();
  /** Letter → cells holding it, for finding crossings fast. */
  byLetter = new Map<string, { row: number; col: number }[]>();
  minRow = 0;
  maxRow = -1;
  minCol = 0;
  maxCol = -1;
  placements: CrosswordPlacement[] = [];
  crossings = 0;

  get empty() {
    return this.placements.length === 0;
  }

  at(row: number, col: number) {
    return this.cells.get(cellKey(row, col));
  }

  /**
   * Whether `answer` may go at (row, col, dir), and how many existing letters
   * it crosses. Null when illegal.
   */
  check(answer: string, row: number, col: number, dir: CrosswordDir, maxSize: number): number | null {
    const [dr, dc] = step(dir);
    const n = answer.length;
    // The box with this word in it must stay within maxSize.
    if (!this.empty) {
      const h = Math.max(this.maxRow, row + dr * (n - 1)) - Math.min(this.minRow, row) + 1;
      const w = Math.max(this.maxCol, col + dc * (n - 1)) - Math.min(this.minCol, col) + 1;
      if (h > maxSize || w > maxSize) return null;
    } else if (n > maxSize) return null;
    // No running on into another word at either end.
    if (this.at(row - dr, col - dc) || this.at(row + dr * n, col + dc * n)) return null;
    let crossings = 0;
    for (let i = 0; i < n; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      const cell = this.at(r, c);
      if (cell) {
        if (cell.letter !== answer[i]) return null;
        // Already used in this direction: an overlap, not a crossing.
        if (dir === "across" ? cell.across : cell.down) return null;
        crossings++;
      } else {
        // A new letter must not sit beside another word.
        if (this.at(r + dc, c + dr) || this.at(r - dc, c - dr)) return null;
      }
    }
    if (!this.empty && crossings === 0) return null;
    // Every letter crossed would mean it lies along existing cells — never legal.
    if (crossings === n) return null;
    return crossings;
  }

  place(p: CrosswordPlacement, crossings: number) {
    const [dr, dc] = step(p.dir);
    for (let i = 0; i < p.answer.length; i++) {
      const r = p.row + dr * i;
      const c = p.col + dc * i;
      const k = cellKey(r, c);
      let cell = this.cells.get(k);
      if (!cell) {
        cell = { letter: p.answer[i], across: false, down: false };
        this.cells.set(k, cell);
        const list = this.byLetter.get(cell.letter) ?? [];
        list.push({ row: r, col: c });
        this.byLetter.set(cell.letter, list);
      }
      if (p.dir === "across") cell.across = true;
      else cell.down = true;
      if (this.empty && i === 0) {
        this.minRow = this.maxRow = r;
        this.minCol = this.maxCol = c;
      }
      this.minRow = Math.min(this.minRow, r);
      this.maxRow = Math.max(this.maxRow, r);
      this.minCol = Math.min(this.minCol, c);
      this.maxCol = Math.max(this.maxCol, c);
    }
    this.placements.push(p);
    this.crossings += crossings;
  }

  /** Every legal crossing position for `answer`, scored. */
  candidates(answer: string, maxSize: number, rng: () => number): Candidate[] {
    const out: Candidate[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < answer.length; i++) {
      for (const at of this.byLetter.get(answer[i]) ?? []) {
        const cell = this.at(at.row, at.col)!;
        for (const dir of ["across", "down"] as const) {
          if (dir === "across" ? cell.across : cell.down) continue;
          const [dr, dc] = step(dir);
          const row = at.row - dr * i;
          const col = at.col - dc * i;
          const k = `${row},${col},${dir}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const crossings = this.check(answer, row, col, dir, maxSize);
          if (crossings == null) continue;
          const [er, ec] = [row + dr * (answer.length - 1), col + dc * (answer.length - 1)];
          const h = Math.max(this.maxRow, er) - Math.min(this.minRow, row) + 1;
          const w = Math.max(this.maxCol, ec) - Math.min(this.minCol, col) + 1;
          // Crossings dominate; then a small, square box; a little noise breaks ties.
          const score = crossings * 40 - boxCost(h, w) + rng() * 4;
          out.push({ row, col, dir, crossings, score });
        }
      }
    }
    return out;
  }
}

/** Better attempt: more words, then more crossings, then a smaller squarer box. */
function better(a: Attempt, b: Attempt | null): boolean {
  if (!b) return true;
  if (a.placements.length !== b.placements.length) return a.placements.length > b.placements.length;
  if (a.crossings !== b.crossings) return a.crossings > b.crossings;
  const ca = boxCost(a.maxRow - a.minRow + 1, a.maxCol - a.minCol + 1);
  const cb = boxCost(b.maxRow - b.minRow + 1, b.maxCol - b.minCol + 1);
  return ca < cb;
}

/**
 * One attempt: a greedy grid grown from a random long word. Synchronous;
 * exported so a script can time it.
 */
export function layoutAttempt(
  words: readonly LayoutWord[],
  rng: () => number,
  opts: Pick<LayoutOptions, "maxWords" | "maxSize">,
): Attempt {
  const grid = new Grid();
  const pool = shuffled(
    words.filter((w) => w.answer.length >= 2 && w.answer.length <= opts.maxSize),
    rng,
  );
  if (!pool.length) return { placements: [], crossings: 0, minRow: 0, maxRow: -1, minCol: 0, maxCol: -1 };
  // Start from one of the longer words (random among the top third).
  const byLen = [...pool].sort((a, b) => b.answer.length - a.answer.length);
  const first = byLen[Math.floor(rng() * Math.max(1, Math.ceil(byLen.length / 3)))];
  const firstDir: CrosswordDir = rng() < 0.5 ? "across" : "down";
  grid.place({ answer: first.answer, clue: first.clue ?? "", row: 0, col: 0, dir: firstDir }, 0);
  let rest = pool.filter((w) => w !== first);

  while (grid.placements.length < opts.maxWords && rest.length) {
    let best: { word: LayoutWord; c: Candidate } | null = null;
    let looked = 0;
    for (const word of rest) {
      const cands = grid.candidates(word.answer, opts.maxSize, rng);
      if (!cands.length) continue;
      for (const c of cands) if (!best || c.score > best.c.score) best = { word, c };
      if (++looked >= LOOKAHEAD) break;
    }
    if (!best) break; // nothing left fits
    const { word, c } = best;
    grid.place({ answer: word.answer, clue: word.clue ?? "", row: c.row, col: c.col, dir: c.dir }, c.crossings);
    rest = rest.filter((w) => w !== word);
  }
  return {
    placements: grid.placements,
    crossings: grid.crossings,
    minRow: grid.minRow,
    maxRow: grid.maxRow,
    minCol: grid.minCol,
    maxCol: grid.maxCol,
  };
}

const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Lay out a puzzle from candidate words. Answers are deduplicated. Rejects with
 * CrosswordLayoutError when the best attempt places fewer than `minWords`.
 */
export async function layoutCrossword(words: readonly LayoutWord[], opts: LayoutOptions): Promise<LayoutResult> {
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const seen = new Set<string>();
  const unique = words.filter((w) => w.answer && !seen.has(w.answer) && (seen.add(w.answer), true));
  const started = now();
  let best: Attempt | null = null;
  let attempts = 0;
  while (attempts < maxAttempts) {
    const a = layoutAttempt(unique, seededRng(opts.seed * 7919 + attempts * 104729 + 1), opts);
    attempts++;
    if (better(a, best)) best = a;
    await yieldNow();
    if (now() - started >= budget) break;
  }
  const placed = best?.placements.length ?? 0;
  if (!best || placed < opts.minWords) {
    throw new CrosswordLayoutError(`layout placed ${placed} of ${unique.length} words (need ${opts.minWords})`, placed);
  }
  const placements = best.placements.map((p) => ({ ...p, row: p.row - best!.minRow, col: p.col - best!.minCol }));
  return {
    placements,
    entries: numberEntries(placements),
    width: best.maxCol - best.minCol + 1,
    height: best.maxRow - best.minRow + 1,
    crossings: best.crossings,
    attempts,
  };
}

/**
 * Candidate pick for a puzzle build (docs/crossword-mode-plan.md §7.3 step 1).
 *
 * About 60 playable words from the bank: accepted, with clues, unflagged, not
 * a name or place, not rejected by the operator (all in shared
 * bankPlayableFilter), at or above the scene's `minZipf`, and not used in the
 * scene's last `noRepeatWordsPuzzles` puzzles. Lengths are spread on purpose
 * — mostly 5–8 letters, some short ones to knit the grid, a few long ones to
 * anchor it. Seeded, so a build is repeatable.
 *
 * With no bank imported (or too little of it playable), the pick falls back to
 * the seed set. The no-repeat window does not apply to the seed set: it is 43
 * words, and a box with no bank has nothing else to play.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import { normalizeAnswer, type CrosswordConfig, type CrosswordPuzzleSource } from "@photonsurge/shared/crossword";
import { CROSSWORD_SEED_THEME, CROSSWORD_SEED_WORDS } from "@photonsurge/shared/crossword-seeds";
import { seededRng, shuffled } from "./layout";

export const PICK_COUNT = 60;

/** How many words of each length one round of the spread takes. */
const LENGTH_WEIGHTS: Record<number, number> = { 3: 1, 4: 2, 5: 3, 6: 3, 7: 3, 8: 2, 9: 2, 10: 1, 11: 1, 12: 1 };

export interface PickedWord {
  /** A–Z. */
  answer: string;
  /** The bank word's id (bank source). */
  bankId?: string;
  /** The seed set's clue (seed source). */
  clue?: string;
  zipf?: number;
}

export interface CandidatePick {
  source: Extract<CrosswordPuzzleSource, "seed" | "bank">;
  /** The seed set's theme, or "" for a general bank pick. */
  theme: string;
  words: PickedWord[];
  /** Words left out by the no-repeat window. */
  excluded: number;
}

type PickDb = Pick<AppDb, "crosswordBank" | "crosswordPuzzles">;
type PickConfig = Pick<CrosswordConfig, "minZipf" | "noRepeatWordsPuzzles" | "minWords" | "maxSize">;

/**
 * Take up to `count` words, round-robin over lengths by LENGTH_WEIGHTS, each
 * length's pool shuffled with `rng`. The result is shuffled too.
 */
export function spreadByLength<T extends { answer: string }>(words: readonly T[], count: number, rng: () => number): T[] {
  const byLen = new Map<number, T[]>();
  for (const w of words) {
    const n = w.answer.length;
    byLen.set(n, [...(byLen.get(n) ?? []), w]);
  }
  const lengths = [...byLen.keys()].sort((a, b) => a - b);
  for (const n of lengths) byLen.set(n, shuffled(byLen.get(n)!, rng));
  const out: T[] = [];
  while (out.length < count) {
    let took = 0;
    for (const n of lengths) {
      const pool = byLen.get(n)!;
      for (let k = 0; k < (LENGTH_WEIGHTS[n] ?? 1) && pool.length && out.length < count; k++) {
        out.push(pool.pop()!);
        took++;
      }
    }
    if (!took) break;
  }
  return shuffled(out, rng);
}

/** The seed set as candidates. */
export function seedCandidates(rng: () => number, count = PICK_COUNT): CandidatePick {
  const words = CROSSWORD_SEED_WORDS.map((w) => ({ answer: normalizeAnswer(w.answer), clue: w.clue }));
  return { source: "seed", theme: CROSSWORD_SEED_THEME, words: spreadByLength(words, count, rng), excluded: 0 };
}

/** Pick the build's candidate words for a scene. */
export async function pickCandidates(
  db: PickDb,
  sceneId: string,
  cfg: PickConfig,
  opts: { seed: number; count?: number },
): Promise<CandidatePick> {
  const count = opts.count ?? PICK_COUNT;
  const rng = seededRng(opts.seed);
  const recent = await db.crosswordPuzzles.recentForScene(sceneId, cfg.noRepeatWordsPuzzles);
  const used = new Set(recent.flatMap((p) => p.entries.map((e) => normalizeAnswer(e.answer))));
  const maxLength = Math.min(12, cfg.maxSize);
  const rows = await db.crosswordBank.playable({
    minZipf: cfg.minZipf,
    minLength: 3,
    maxLength,
    // norm is documented as uppercase; the lowercase twins cost nothing in a $nin.
    excludeNorms: [...used].flatMap((a) => [a, a.toLowerCase()]),
  });
  // The query does the work; these checks keep the pick honest whatever the
  // bank's casing, and drop multi-word or hyphenated entries.
  const seen = new Set<string>();
  let excluded = 0;
  const playable: PickedWord[] = [];
  // Sorted first so the same bank gives the same pick for a seed, whatever
  // order Mongo returned it in.
  const sorted = [...rows].sort((a, b) => a.norm.localeCompare(b.norm) || a.id.localeCompare(b.id));
  for (const r of sorted) {
    if (!/^[A-Za-z]+$/.test(r.norm)) continue;
    const answer = normalizeAnswer(r.norm);
    if (answer.length < 3 || answer.length > maxLength || seen.has(answer)) continue;
    if (typeof r.zipf === "number" && r.zipf < cfg.minZipf) continue;
    if (used.has(answer)) {
      excluded++;
      continue;
    }
    seen.add(answer);
    playable.push({ answer, bankId: r.id, ...(typeof r.zipf === "number" ? { zipf: r.zipf } : {}) });
  }
  if (playable.length < cfg.minWords) return seedCandidates(rng, count);
  return { source: "bank", theme: "", words: spreadByLength(playable, count, rng), excluded };
}

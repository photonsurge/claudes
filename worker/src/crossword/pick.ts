/**
 * Candidate pick for a puzzle build (docs/crossword-mode-plan.md §7.3 step 1).
 *
 * About 60 words from the approved pool (`db.crosswordBank.playable`): the
 * word is approved and has at least one approved clue, 3–12 letters (capped
 * by the scene's `maxSize`), at or above the scene's `minZipf`, and not used
 * in the scene's last `noRepeatWordsPuzzles` puzzles. On a family-friendly
 * channel the word and its clues must all carry the tag (the repo does that).
 * Each word comes with the approved clues it may use that pass
 * `validateClue`; a word left with none is dropped. Lengths are spread on
 * purpose — mostly 5–8 letters, some short ones to knit the grid, a few long
 * ones to anchor it. Seeded, so a build is repeatable.
 *
 * `CROSSWORD_ALLOW_UNAPPROVED=true` (a dev box only, §7.4) lets the pick use
 * pending words with their cleaned stored clues.
 *
 * With no bank imported at all, the pick is the seed set (approved and family
 * friendly, seed ids). A bank that is imported but too thin is NOT topped up
 * from the seed set: the build fails and says how many words were available.
 * The no-repeat window does not apply to the seed set: it is a few dozen
 * words, and a box with no bank has nothing else to play.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import {
  normalizeAnswer,
  validateClue,
  type CrosswordConfig,
  type CrosswordPuzzleSource,
} from "@photonsurge/shared/crossword";
import { CROSSWORD_SEED_WORDS } from "@photonsurge/shared/crossword-seeds";
import { seededRng, shuffled } from "./layout";

export const PICK_COUNT = 60;

/** How many words of each length one round of the spread takes. */
const LENGTH_WEIGHTS: Record<number, number> = { 3: 1, 4: 2, 5: 3, 6: 3, 7: 3, 8: 2, 9: 2, 10: 1, 11: 1, 12: 1 };

/** A clue a picked word may use. */
export interface PickedClue {
  id: string;
  text: string;
  familyFriendly: boolean | null;
}

export interface PickedWord {
  /** A–Z. */
  answer: string;
  /** The bank word's id, or the seed id. */
  wordId: string;
  familyFriendly: boolean | null;
  /** The approved clues it may use (never empty), by id. */
  clues: PickedClue[];
  zipf?: number;
}

export interface CandidatePick {
  source: Extract<CrosswordPuzzleSource, "seed" | "bank">;
  words: PickedWord[];
  /** Playable words the pool offered this scene, before the spread took its share. */
  available: number;
  /** Words left out by the no-repeat window. */
  excluded: number;
  /** The pick used pending words (CROSSWORD_ALLOW_UNAPPROVED). */
  unapproved: boolean;
}

type PickDb = Pick<AppDb, "crosswordBank" | "crosswordPuzzles">;
type PickConfig = Pick<CrosswordConfig, "minZipf" | "noRepeatWordsPuzzles" | "maxSize" | "familyFriendlyOnly" | "blocklist">;

/** The dev-box switch (§7.4). Anything but "true" is off. */
export const allowUnapprovedFromEnv = () => process.env.CROSSWORD_ALLOW_UNAPPROVED === "true";

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

/** The seed set as candidates: approved and family friendly, with seed ids. */
export function seedCandidates(rng: () => number, count = PICK_COUNT): CandidatePick {
  const words: PickedWord[] = CROSSWORD_SEED_WORDS.map((w) => ({
    answer: normalizeAnswer(w.answer),
    wordId: w.id,
    familyFriendly: true,
    clues: [{ id: w.clueId, text: w.clue, familyFriendly: true }],
  }));
  return { source: "seed", words: spreadByLength(words, count, rng), available: words.length, excluded: 0, unapproved: false };
}

/** Is any word bank imported? A box with none builds from the seed set. */
export async function bankImported(db: Pick<AppDb, "crosswordBank">): Promise<boolean> {
  return (await db.crosswordBank.words().estimatedDocumentCount()) > 0;
}

/** Pick the build's candidate words for a scene. */
export async function pickCandidates(
  db: PickDb,
  sceneId: string,
  cfg: PickConfig,
  opts: { seed: number; count?: number; allowUnapproved?: boolean },
): Promise<CandidatePick> {
  const count = opts.count ?? PICK_COUNT;
  const allowUnapproved = opts.allowUnapproved ?? allowUnapprovedFromEnv();
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
    familyFriendlyOnly: cfg.familyFriendlyOnly,
    allowUnapproved,
  });
  if (!rows.length && !(await bankImported(db))) return seedCandidates(rng, count);

  // The query does the work; these checks keep the pick honest whatever the
  // bank's casing, and drop multi-word or hyphenated entries.
  const seen = new Set<string>();
  let excluded = 0;
  const playable: PickedWord[] = [];
  // Sorted first so the same bank gives the same pick for a seed, whatever
  // order Mongo returned it in.
  const sorted = [...rows].sort((a, b) => a.norm.localeCompare(b.norm) || a.id.localeCompare(b.id));
  // The tags are the repo's to check too; checked again here unless the dev
  // switch is on (which ignores them).
  const tagged = cfg.familyFriendlyOnly && !allowUnapproved;
  for (const r of sorted) {
    if (!/^[A-Za-z]+$/.test(r.norm)) continue;
    const answer = normalizeAnswer(r.norm);
    if (answer.length < 3 || answer.length > maxLength || seen.has(answer)) continue;
    if (typeof r.zipf === "number" && r.zipf < cfg.minZipf) continue;
    if (tagged && r.familyFriendly !== true) continue;
    if (used.has(answer)) {
      excluded++;
      continue;
    }
    // The guard (§7.3 step 4): only clues that pass validateClue — length,
    // the answer not in the clue, the blocklist — so every candidate laid out
    // can be clued.
    const clues = (r.clues ?? [])
      .filter((c) => (!tagged || c.familyFriendly === true) && !validateClue(c.text, answer, cfg.blocklist))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!clues.length) continue;
    seen.add(answer);
    playable.push({
      answer,
      wordId: r.id,
      familyFriendly: r.familyFriendly,
      clues,
      ...(typeof r.zipf === "number" ? { zipf: r.zipf } : {}),
    });
  }
  return {
    source: "bank",
    words: spreadByLength(playable, count, rng),
    available: playable.length,
    excluded,
    unapproved: allowUnapproved,
  };
}

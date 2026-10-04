/**
 * Build a crossword puzzle (docs/crossword-mode-plan.md §7.3), and the two
 * small jobs around it: top-up (§7.5) and the bank index (§7.2 step 3).
 *
 * A build uses only what a person has approved (§7.4), so it makes no model
 * call and its puzzle is `ready` the moment it is stored:
 *   1. pick ~60 candidates from the approved pool (pick.ts), each with the
 *      approved clues it may use that pass `validateClue`;
 *   2. lay them out (layout.ts);
 *   3. give each placed word, from its own approved clues, the one this
 *      channel used longest ago — a clue never played on the channel counts
 *      as oldest, ties by clue id. "Used" comes from the channel's played
 *      puzzles' entries (`clueId`), so nothing new is stored;
 *   4. run `validateClue` again as a guard (the scene's blocklist included);
 *   5. store it `ready`, family friendly when every word and clue in it is
 *      tagged so, entries carrying `wordId` and `clueId`.
 * Fewer than `minWords` and the build fails with CrosswordBuildError, saying
 * how many approved words were available (and how many family friendly when
 * the channel's switch is on).
 *
 * `CROSSWORD_ALLOW_UNAPPROVED=true` (a dev box only) lets the pick take
 * pending words with their cleaned stored clues. Suggestions are a separate
 * job (`crossword.suggest`) and never reach a build.
 */
import { randomUUID } from "node:crypto";
import type { AppDb } from "@photonsurge/shared/db/index";
import {
  numberEntries,
  unplayedStock,
  validateClue,
  type CrosswordConfig,
  type CrosswordGenerateRequest,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";
import { BANK_WORD_INDEXES } from "@photonsurge/shared/crossword-bank";
import { CrosswordLayoutError, layoutCrossword, type LayoutOptions } from "./layout";
import { pickCandidates, type CandidatePick, type PickedClue, type PickedWord } from "./pick";

/** The bank's pick index from the first build, replaced by `xwbank_approved_pick_ix`. */
export const LEGACY_BANK_INDEXES = ["xwbank_pick_ix"] as const;

/** The build could not make a puzzle (the pool is too small, or the layout fell short). */
export class CrosswordBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrosswordBuildError";
  }
}

export interface BuildOptions {
  /** Build and return, store nothing (the CLI's --dry). */
  dryRun?: boolean;
  /** Override CROSSWORD_ALLOW_UNAPPROVED (tests). */
  allowUnapproved?: boolean;
  /** Layout overrides (tests pin `maxAttempts`). */
  layout?: Partial<Pick<LayoutOptions, "budgetMs" | "maxAttempts" | "now">>;
  now?: () => number;
}

export interface BuildResult {
  puzzle: CrosswordPuzzle;
  seed: number;
  source: CrosswordPuzzle["source"];
  /** Words offered to the layout. */
  candidates: number;
  /** Playable words the pool had for this channel. */
  available: number;
  /** The pick used pending words (CROSSWORD_ALLOW_UNAPPROVED). */
  unapproved: boolean;
  attempts: number;
  crossings: number;
}

type BuildDb = Pick<AppDb, "crosswordBank" | "crosswordPuzzles" | "getOrInitCrosswordConfig">;

/**
 * Clue id → when this scene last started a puzzle using it. Built from every
 * puzzle the scene has played (the clue history has no window).
 */
export function clueLastUsed(played: readonly CrosswordPuzzle[], sceneId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of played) {
    const at = Math.max(-Infinity, ...p.plays.filter((x) => x.sceneId === sceneId).map((x) => x.startedAt));
    if (!Number.isFinite(at)) continue;
    for (const e of p.entries) if (e.clueId && at > (out.get(e.clueId) ?? -Infinity)) out.set(e.clueId, at);
  }
  return out;
}

/**
 * The clue for a word (§7.3 step 3): of its clues that pass `validateClue`,
 * the one this channel used longest ago; never used counts as oldest; ties by
 * clue id. Null when none passes.
 */
export function chooseClue(
  word: Pick<PickedWord, "answer" | "clues">,
  lastUsed: ReadonlyMap<string, number>,
  blocklist: readonly string[] = [],
): PickedClue | null {
  const ok = word.clues.filter((c) => !validateClue(c.text, word.answer, blocklist));
  ok.sort(
    (a, b) => (lastUsed.get(a.id) ?? -Infinity) - (lastUsed.get(b.id) ?? -Infinity) || a.id.localeCompare(b.id),
  );
  return ok[0] ?? null;
}

/** "N approved words" (with the family-friendly part on such a channel), for a failure message. */
async function poolNote(db: BuildDb, pick: CandidatePick, cfg: Pick<CrosswordConfig, "familyFriendlyOnly">): Promise<string> {
  if (pick.source === "seed") return `${pick.available} seed words`;
  const kind = pick.unapproved ? "playable (unapproved allowed)" : cfg.familyFriendlyOnly ? "family-friendly approved" : "approved";
  let note = `${pick.available} ${kind} word(s) available to this channel`;
  try {
    const pool = await db.crosswordBank.poolCounts();
    note += cfg.familyFriendlyOnly
      ? `; the approved pool holds ${pool.words} word(s), ${pool.ffWords} family friendly`
      : `; the approved pool holds ${pool.words} word(s)`;
  } catch {
    // The count is a courtesy in an error message; the build failed either way.
  }
  return note;
}

/** "Puzzle N": one more than the puzzles stored so far. */
async function nextTitle(db: BuildDb): Promise<string> {
  const n = await db.crosswordPuzzles.model.countDocuments({}).exec();
  return `Puzzle ${n + 1}`;
}

/** Build one puzzle for a scene and (unless dry) store it. */
export async function buildPuzzle(db: BuildDb, req: CrosswordGenerateRequest, opts: BuildOptions = {}): Promise<BuildResult> {
  const now = opts.now ?? Date.now;
  if (!req?.sceneId) throw new CrosswordBuildError("sceneId is required");
  const seed = Number.isFinite(req.seed) ? Math.floor(req.seed as number) : now() % 2_147_483_647;
  const cfg = await db.getOrInitCrosswordConfig(req.sceneId);
  const pick = await pickCandidates(db, req.sceneId, cfg, { seed, allowUnapproved: opts.allowUnapproved });
  if (pick.words.length < cfg.minWords) {
    throw new CrosswordBuildError(`too few words for a puzzle (need ${cfg.minWords}): ${await poolNote(db, pick, cfg)}`);
  }

  // Seed words go through the same guard (the scene's blocklist may catch one).
  const lastUsed = clueLastUsed(await db.crosswordPuzzles.recentForScene(req.sceneId, Number.MAX_SAFE_INTEGER), req.sceneId);
  const chosen = new Map<string, PickedClue>();
  for (const w of pick.words) {
    const c = chooseClue(w, lastUsed, cfg.blocklist);
    if (c) chosen.set(w.answer, c);
  }
  const pool = pick.words.filter((w) => chosen.has(w.answer));

  let layout;
  try {
    layout = await layoutCrossword(pool, {
      seed,
      minWords: cfg.minWords,
      maxWords: cfg.maxWords,
      maxSize: cfg.maxSize,
      ...opts.layout,
    });
  } catch (err) {
    if (err instanceof CrosswordLayoutError) throw new CrosswordBuildError(`${err.message}: ${await poolNote(db, pick, cfg)}`);
    throw err;
  }

  const byAnswer = new Map(pool.map((w) => [w.answer, w]));
  const placements = layout.placements.map((p) => {
    const c = chosen.get(p.answer)!;
    return { ...p, clue: c.text, wordId: byAnswer.get(p.answer)!.wordId, clueId: c.id };
  });
  const familyFriendly = layout.placements.every(
    (p) => byAnswer.get(p.answer)!.familyFriendly === true && chosen.get(p.answer)!.familyFriendly === true,
  );
  const puzzle: CrosswordPuzzle = {
    id: randomUUID(),
    title: await nextTitle(db),
    width: layout.width,
    height: layout.height,
    entries: numberEntries(placements),
    status: "ready",
    familyFriendly,
    source: pick.source,
    createdAt: now(),
    plays: [],
  };
  if (!opts.dryRun) await db.crosswordPuzzles.upsert(puzzle);
  return {
    puzzle,
    seed,
    source: pick.source,
    candidates: pool.length,
    available: pick.available,
    unapproved: pick.unapproved,
    attempts: layout.attempts,
    crossings: layout.crossings,
  };
}

// ---------------------------------------------------------------------------
// Top-up (§7.5) and the bank index (§7.2 step 3)
// ---------------------------------------------------------------------------

export type TopUpOutcome =
  | { sceneId: string; outcome: "built"; puzzleId: string; words: number; familyFriendly: boolean }
  | { sceneId: string; outcome: "disabled" | "stocked" }
  /** The pool cannot supply a puzzle for this channel (the channel replays meanwhile). */
  | { sceneId: string; outcome: "skipped"; reason: string }
  | { sceneId: string; outcome: "failed"; error: string };

type TopUpDb = BuildDb & Pick<AppDb, "crosswordScenes">;

/**
 * One build for each enabled crossword scene whose unplayed stock — the
 * puzzles it may play, so family-friendly ones only on a family-friendly
 * channel — is below its `stockTarget`. A scene the pool cannot supply is
 * skipped with the reason; one scene's failure does not stop the others.
 */
export async function topUpScenes(db: TopUpDb, opts: BuildOptions = {}): Promise<TopUpOutcome[]> {
  const out: TopUpOutcome[] = [];
  const sceneIds = await db.crosswordScenes();
  if (!sceneIds.length) return out;
  const ready = await db.crosswordPuzzles.list({ status: "ready" });
  for (const sceneId of sceneIds) {
    try {
      const cfg = await db.getOrInitCrosswordConfig(sceneId);
      if (!cfg.enabled) {
        out.push({ sceneId, outcome: "disabled" });
        continue;
      }
      if (unplayedStock(ready, sceneId, { familyFriendlyOnly: cfg.familyFriendlyOnly }) >= cfg.stockTarget) {
        out.push({ sceneId, outcome: "stocked" });
        continue;
      }
      const r = await buildPuzzle(db, { sceneId }, opts);
      ready.push(r.puzzle);
      out.push({
        sceneId,
        outcome: "built",
        puzzleId: r.puzzle.id,
        words: r.puzzle.entries.length,
        familyFriendly: r.puzzle.familyFriendly,
      });
    } catch (err) {
      if (err instanceof CrosswordBuildError) out.push({ sceneId, outcome: "skipped", reason: err.message });
      else out.push({ sceneId, outcome: "failed", error: (err as Error)?.message ?? String(err) });
    }
  }
  return out;
}

/**
 * Build the word bank's indexes and drop the ones they replace. Idempotent:
 * an existing index is left as it is, and a legacy one already gone is
 * skipped.
 */
export async function indexBank(db: Pick<AppDb, "crosswordBank">): Promise<{ indexes: string[]; dropped: string[] }> {
  const indexes = await db.crosswordBank.ensureIndexes();
  const dropped: string[] = [];
  // ensureIndexes has created the collection, so listing its indexes is safe.
  const words = db.crosswordBank.words();
  for (const name of LEGACY_BANK_INDEXES) {
    if (BANK_WORD_INDEXES.some((ix) => ix.name === name)) continue;
    if (await words.indexExists(name)) {
      await words.dropIndex(name);
      dropped.push(name);
    }
  }
  return { indexes, dropped };
}

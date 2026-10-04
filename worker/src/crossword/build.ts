/**
 * Build a crossword puzzle (docs/crossword-mode-plan.md §7.3), and the two
 * small jobs around it: top-up (§7.5) and the bank index (§7.2 step 3).
 *
 * A build: pick ~60 candidate words (pick.ts), lay them out (layout.ts), give
 * each placed word a clue, and if any is left with no usable clue, drop it —
 * and every other candidate that cannot be clued — and lay out again. Then store the puzzle as `draft` (or `ready` under the
 * scene's auto-approve). Fewer than `minWords` placed and clued and the build
 * fails with CrosswordBuildError.
 *
 * Clue order for a placed word:
 *   1. a clue the operator APPROVED for it (§8.3), as written;
 *   2. POLISH — the seam for WP11's model call (`BuildOptions.polish`). Not
 *      wired in P0: with no polisher the builder goes straight to 3;
 *   3. the best STORED clue: every candidate clue run through `cleanClue`,
 *      kept if `validateClue` passes (length, no answer leak, blocklist), and
 *      the best of those taken — the one whose length is nearest
 *      STORED_CLUE_TARGET characters. The bank's own difficulty score is no
 *      use for this (most clues say "3"), and very short clues are the vague
 *      ones ("Do fast"), so mid-length wins; ties go alphabetically so a
 *      build is repeatable.
 * Every clue, whatever its source, must pass `validateClue` against the
 * built-in blocklist plus the scene's own. Seed-set words carry their clue.
 */
import { randomUUID } from "node:crypto";
import type { AppDb } from "@photonsurge/shared/db/index";
import type { BankBuildWord } from "@photonsurge/shared/db/crossword-bank-repo";
import type { BankClue, BankSense } from "@photonsurge/shared/crossword-bank";
import {
  cleanClue,
  numberEntries,
  unplayedStock,
  validateClue,
  type CrosswordGenerateRequest,
  type CrosswordPuzzle,
} from "@photonsurge/shared/crossword";
import { CrosswordLayoutError, layoutCrossword, type LayoutOptions } from "./layout";
import { pickCandidates, type PickedWord } from "./pick";

export const GENERAL_TITLE = "General knowledge";
/** The stored clue length the picker aims for (CLUE_MIN 8 … CLUE_MAX 48). */
export const STORED_CLUE_TARGET = 30;
/**
 * Lay-out rounds. The second round only lays out words already known to
 * clue, so it needs no more; the cap is a guard.
 */
const MAX_ROUNDS = 3;

/** The build could not make a puzzle (too few words placed or clued). */
export class CrosswordBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrosswordBuildError";
  }
}

export type ClueVia = "approved" | "polish" | "stored" | "seed";

export interface ClueChoice {
  text: string;
  via: ClueVia;
}

/** What a clue polisher is given for one placed word. */
export interface PolishWord {
  answer: string;
  senses: BankSense[];
  /** The word's stored clues (cleaned), best first. */
  candidates: string[];
}

/**
 * WP11 SEAM — clue polish (§7.3 step 3). One call for all the placed words
 * that have no approved clue; returns a clue per answer (any it leaves out
 * fall back to the stored clue) and the model that wrote them. The builder
 * validates every returned clue the same way as a stored one. Saving a
 * polished clue back to the bank as a candidate (`db.crosswordBank.addClues`)
 * belongs with the polisher.
 */
export type CluePolisher = (words: PolishWord[]) => Promise<{ clues: Map<string, string>; model?: string }>;

export interface BuildOptions {
  /** Build and return, store nothing (the CLI's --dry). */
  dryRun?: boolean;
  /** Clue polish (WP11). Left out in P0. */
  polish?: CluePolisher;
  /** Layout overrides (tests pin `maxAttempts`). */
  layout?: Partial<Pick<LayoutOptions, "budgetMs" | "maxAttempts" | "now">>;
  now?: () => number;
}

export interface BuildResult {
  puzzle: CrosswordPuzzle;
  seed: number;
  source: CrosswordPuzzle["source"];
  candidates: number;
  /** Placed words dropped for want of a usable clue. */
  dropped: string[];
  /** Clue source per answer. */
  clueVia: Record<string, ClueVia>;
  attempts: number;
  crossings: number;
}

type BuildDb = Pick<AppDb, "crosswordBank" | "crosswordPuzzles" | "getOrInitCrosswordConfig">;

/** A clue that passes, cleaned — or null. */
function usable(text: string | undefined, answer: string, blocklist: readonly string[]): string | null {
  if (!text) return null;
  const c = cleanClue(text);
  return validateClue(c, answer, blocklist) ? null : c;
}

/** Usable stored candidate clues for a word, best first (see the header). */
export function rankStoredClues(clues: readonly BankClue[], answer: string, blocklist: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of clues) {
    if (c.approval.status !== "pending") continue;
    const t = usable(c.text, answer, blocklist);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.sort(
    (a, b) => Math.abs(a.length - STORED_CLUE_TARGET) - Math.abs(b.length - STORED_CLUE_TARGET) || a.localeCompare(b),
  );
}

/** An approved clue that passes, if the operator approved one. */
export function approvedClue(clues: readonly BankClue[], answer: string, blocklist: readonly string[] = []): string | null {
  for (const c of clues) {
    if (c.approval.status !== "approved") continue;
    const t = usable(c.text, answer, blocklist);
    if (t) return t;
  }
  return null;
}

/**
 * Clue every placed word not already in `known`, in the order the header
 * gives. Mutates and returns `known` (answer → choice, or null when the word
 * has no usable clue). `polish` is only offered the first time round, so a
 * puzzle costs one model call at most.
 */
async function clueWords(
  placed: PickedWord[],
  bank: Map<string, BankBuildWord>,
  blocklist: readonly string[],
  known: Map<string, ClueChoice | null>,
  polish: CluePolisher | undefined,
): Promise<{ known: Map<string, ClueChoice | null>; model?: string }> {
  const fresh = placed.filter((w) => !known.has(w.answer));
  const toPolish: PolishWord[] = [];
  for (const w of fresh) {
    if (!w.bankId) {
      const t = usable(w.clue, w.answer, blocklist);
      known.set(w.answer, t ? { text: t, via: "seed" } : null);
      continue;
    }
    const bw = bank.get(w.bankId);
    const approved = approvedClue(bw?.clues ?? [], w.answer, blocklist);
    if (approved) {
      known.set(w.answer, { text: approved, via: "approved" });
      continue;
    }
    toPolish.push({ answer: w.answer, senses: bw?.senses ?? [], candidates: rankStoredClues(bw?.clues ?? [], w.answer, blocklist) });
  }

  let polished = new Map<string, string>();
  let model: string | undefined;
  if (polish && toPolish.length) {
    // ---- WP11 seam: the model polish. Nothing is passed here in P0. ----
    const res = await polish(toPolish);
    polished = res.clues;
    model = res.model;
  }
  for (const w of toPolish) {
    const p = usable(polished.get(w.answer), w.answer, blocklist);
    if (p) known.set(w.answer, { text: p, via: "polish" });
    else known.set(w.answer, w.candidates[0] ? { text: w.candidates[0], via: "stored" } : null);
  }
  return { known, model };
}

/** Build one puzzle for a scene and (unless dry) store it. */
export async function buildPuzzle(db: BuildDb, req: CrosswordGenerateRequest, opts: BuildOptions = {}): Promise<BuildResult> {
  const now = opts.now ?? Date.now;
  if (!req?.sceneId) throw new CrosswordBuildError("sceneId is required");
  const seed = Number.isFinite(req.seed) ? Math.floor(req.seed as number) : now() % 2_147_483_647;
  const cfg = await db.getOrInitCrosswordConfig(req.sceneId);
  const pick = await pickCandidates(db, req.sceneId, cfg, { seed });

  const bank = new Map<string, BankBuildWord>();
  const known = new Map<string, ClueChoice | null>();
  const dropped: string[] = [];
  let pool = pick.words;
  let model: string | undefined;

  for (let round = 0; ; round++) {
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
      if (err instanceof CrosswordLayoutError) {
        throw new CrosswordBuildError(
          `${err.message}${dropped.length ? ` after dropping ${dropped.length} unclued word(s)` : ""}`,
        );
      }
      throw err;
    }
    const byAnswer = new Map(pool.map((w) => [w.answer, w]));
    const placed = layout.placements.map((p) => byAnswer.get(p.answer)!);

    const need = placed.filter((w) => w.bankId && !bank.has(w.bankId)).map((w) => w.bankId!);
    if (need.length) for (const bw of await db.crosswordBank.forBuild(need)) bank.set(bw.id, bw);

    const res = await clueWords(placed, bank, cfg.blocklist, known, round === 0 ? opts.polish : undefined);
    model = model ?? res.model;

    const missing = placed.filter((w) => !known.get(w.answer));
    if (!missing.length) {
      const placements = layout.placements.map((p) => ({ ...p, clue: known.get(p.answer)!.text }));
      const title = pick.theme || GENERAL_TITLE;
      // WP2 rework: entries carry no wordId/clueId yet, the puzzle is not built
      // only from approved words and clues, and familyFriendly is not derived.
      const puzzle: CrosswordPuzzle = {
        id: randomUUID(),
        title,
        width: layout.width,
        height: layout.height,
        entries: numberEntries(placements),
        status: "ready",
        familyFriendly: pick.source === "seed",
        source: pick.source,
        createdAt: now(),
        plays: [],
      };
      if (!opts.dryRun) await db.crosswordPuzzles.upsert(puzzle);
      const clueVia: Record<string, ClueVia> = {};
      for (const w of placed) clueVia[w.answer] = known.get(w.answer)!.via;
      return {
        puzzle,
        seed,
        source: pick.source,
        candidates: pick.words.length,
        dropped,
        clueVia,
        attempts: layout.attempts,
        crossings: layout.crossings,
      };
    }
    if (round + 1 >= MAX_ROUNDS) {
      throw new CrosswordBuildError(`${missing.length} placed word(s) still have no usable clue after ${MAX_ROUNDS} layouts`);
    }
    dropped.push(...missing.map((w) => w.answer));
    // Clue the rest of the pool now (stored clues only; the polish had its one
    // call), so the next layout uses only words that can be clued.
    const rest = pool.filter((w) => w.bankId && !bank.has(w.bankId)).map((w) => w.bankId!);
    if (rest.length) for (const bw of await db.crosswordBank.forBuild(rest)) bank.set(bw.id, bw);
    await clueWords(pool, bank, cfg.blocklist, known, undefined);
    pool = pool.filter((w) => known.get(w.answer));
  }
}

// ---------------------------------------------------------------------------
// Top-up (§7.5) and the bank index (§7.2 step 3)
// ---------------------------------------------------------------------------

export type TopUpOutcome =
  | { sceneId: string; outcome: "built"; puzzleId: string; words: number; status: CrosswordPuzzle["status"] }
  | { sceneId: string; outcome: "disabled" | "stocked" | "awaiting review" }
  | { sceneId: string; outcome: "failed"; error: string };

type TopUpDb = BuildDb & Pick<AppDb, "crosswordScenes">;

/**
 * One build for each enabled crossword scene whose unplayed ready stock is
 * below its `stockTarget`. With auto-approve off, a scene is skipped while
 * the drafts awaiting review already reach its target — otherwise an
 * unattended box would pile up a draft every half hour. One scene's failure
 * does not stop the others.
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
      if (unplayedStock(ready, sceneId) >= cfg.stockTarget) {
        out.push({ sceneId, outcome: "stocked" });
        continue;
      }
      const r = await buildPuzzle(db, { sceneId }, opts);
      ready.push(r.puzzle);
      out.push({ sceneId, outcome: "built", puzzleId: r.puzzle.id, words: r.puzzle.entries.length, status: r.puzzle.status });
    } catch (err) {
      out.push({ sceneId, outcome: "failed", error: (err as Error)?.message ?? String(err) });
    }
  }
  return out;
}

/** Build the word bank's indexes. Idempotent: an existing index is left as it is. */
export async function indexBank(db: Pick<AppDb, "crosswordBank">): Promise<{ indexes: string[] }> {
  return { indexes: await db.crosswordBank.ensureIndexes() };
}

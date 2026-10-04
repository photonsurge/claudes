/**
 * Crossword channel — game helpers shared by the host loop (runner.ts) and the
 * Desk's inject job (inject.ts). Pure apart from `loadPuzzle`, which reads
 * through a per-runner cache. docs/crossword-mode-plan.md §4.
 */
import {
  pickSpotlight,
  revealEntry,
  toPublicState,
  type CrosswordConfig,
  type CrosswordGame,
  type CrosswordPuzzle,
  type CrosswordSpotlight,
} from "@photonsurge/shared/crossword";
import type { AppDb } from "@photonsurge/shared/db/index";

/** The slice of the db facade the runner uses (tests pass a fake). */
export type CrosswordDb = Pick<
  AppDb,
  | "crosswordScenes"
  | "getOrInitCrosswordConfig"
  | "crosswordPuzzles"
  | "crosswordGames"
  | "crosswordSolves"
  | "crosswordPlayers"
  | "activeRunForScene"
>;

/** What `toPublicState` needs besides the game. */
export interface ProjectExtra {
  now: number;
  today: { name: string; points: number }[];
  inputLive: boolean;
}

/** The game with its `seq` bumped and `pub` rebuilt — the one way a change is made public. */
export function bumpAndProject(puzzle: CrosswordPuzzle | null, game: CrosswordGame, extra: ProjectExtra): CrosswordGame {
  const { pub: _old, ...rest } = game;
  const next = { ...rest, seq: game.seq + 1 };
  return { ...next, pub: toPublicState(puzzle, next, extra) };
}

/** A puzzle by id, through the runner's cache. Null for an empty id or a missing puzzle. */
export async function loadPuzzle(
  db: CrosswordDb,
  cache: Map<string, CrosswordPuzzle>,
  id: string,
): Promise<CrosswordPuzzle | null> {
  if (!id) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const p = await db.crosswordPuzzles.get(id);
  if (p) cache.set(id, p);
  return p;
}

/** A spotlight on `entryId` starting now for the config's clue time. */
export const spotlightOn = (entryId: string, now: number, cfg: Pick<CrosswordConfig, "clueS">): CrosswordSpotlight => ({
  entryId,
  startedAt: now,
  endsAt: now + cfg.clueS * 1000,
});

/**
 * The next spotlight entry, optionally passing over `skip` (the Desk's Skip
 * clue: the word stays open, the spotlight moves on). Falls back to `skip`
 * itself when it is the only word left open.
 */
export function nextSpotlightEntry(puzzle: CrosswordPuzzle, game: CrosswordGame, skip?: string) {
  if (skip) {
    const others = { ...puzzle, entries: puzzle.entries.filter((e) => e.id !== skip) };
    const pick = pickSpotlight(others, game);
    if (pick) return pick;
  }
  return pickSpotlight(puzzle, game);
}

/** The host fills every open word (the ceiling, the Desk's Next puzzle). */
export function revealAll(puzzle: CrosswordPuzzle, game: CrosswordGame, now: number): CrosswordGame {
  let g = game;
  for (const e of puzzle.entries) g = revealEntry(g, e, now);
  return g;
}

/**
 * Move every running deadline `ms` later: after a pause or a park, the clock
 * picks up where it froze. The current spotlight's hints move with it, so the
 * hint schedule (counted from the spotlight's start) does not re-leak them.
 */
export function shiftDeadlines(game: CrosswordGame, ms: number): CrosswordGame {
  if (ms <= 0) return game;
  const spot = game.spotlight;
  return {
    ...game,
    phaseEndsAt: game.phaseEndsAt ? game.phaseEndsAt + ms : 0,
    puzzleStartedAt: game.puzzleStartedAt ? game.puzzleStartedAt + ms : 0,
    spotlight: spot ? { ...spot, startedAt: spot.startedAt + ms, endsAt: spot.endsAt + ms } : null,
    hints: spot ? game.hints.map((h) => (h.at >= spot.startedAt ? { ...h, at: h.at + ms } : h)) : game.hints,
  };
}

/** The scene's open play on this puzzle (no `endedAt`), latest first. */
export function openPlay(puzzle: CrosswordPuzzle, sceneId: string) {
  return puzzle.plays
    .filter((p) => p.sceneId === sceneId && p.endedAt == null)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

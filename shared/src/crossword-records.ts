/**
 * Crossword channel — the records around the game: the solve log, players and
 * the leaderboards built from them (docs/crossword-mode-plan.md §4.6, §8.3, §9).
 */

/** One word a player took. Append-only. */
export interface CrosswordSolve {
  id: string;
  sceneId: string;
  puzzleId: string;
  entryId: string;
  playerId: string;
  /** The name as it aired. */
  name: string;
  points: number;
  /** When the word landed (the reveal time for a late credit). */
  at: number;
  late?: boolean;
  /** From the Desk's simulator, not YouTube. */
  sim?: boolean;
}

export interface CrosswordPlayer {
  /** `youtube:<authorChannelId>` or `sim:<name>`. */
  id: string;
  /** Latest cleaned display name. */
  name: string;
  hidden: boolean;
  firstSeen: number;
  lastSeen: number;
}

/** A leaderboard row (today, all-time, the Players page). */
export interface CrosswordBoardRow {
  playerId: string;
  name: string;
  points: number;
  words: number;
}

/** Admin Players list row: the player plus all-time totals. */
export interface CrosswordPlayerRow extends CrosswordPlayer {
  points: number;
  words: number;
}

/** Start of the UTC day containing `now` (the "today" board's window). */
export function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Player id for a YouTube chat author. */
export const youtubePlayerId = (authorChannelId: string) => `youtube:${authorChannelId}`;
/** Player id for a Desk simulator name. */
export const simPlayerId = (name: string) => `sim:${name.trim().toLowerCase()}`;

/**
 * Why a crossword channel is idle or replaying (docs/crossword-mode-plan.md
 * §7.5), worded for the Desk. The reason itself is the runner's
 * (`crosswordStockReason`), served by GET /api/crossword/:scene/desk with the
 * approved pool; this only turns it into a line.
 */
import type { CrosswordPhase, CrosswordStockReason } from "@photonsurge/shared/crossword";
import type { BankPoolCounts } from "@photonsurge/shared/crossword-bank";

/** GET /api/crossword/:scene/desk. */
export interface DeskInfo {
  reason: CrosswordStockReason;
  pool: BankPoolCounts | null;
}

export const deskUrl = (sceneId: string) => `/api/crossword/${encodeURIComponent(sceneId)}/desk`;

const poolLine = (pool: BankPoolCounts | null) =>
  pool
    ? ` The approved pool has ${pool.words.toLocaleString("en-GB")} words (${pool.ffWords.toLocaleString("en-GB")} family friendly), about ${pool.puzzlesWithoutRepeat} puzzles without a repeat.`
    : "";

/**
 * The Desk's line, or null when there is nothing to say: fresh stock, or an
 * idle game whose next puzzle is there (it idles because the host is not
 * playing, not for want of stock).
 */
export function deskReason(phase: CrosswordPhase, info: DeskInfo | null): string | null {
  if (!info) return null;
  const { reason, pool } = info;
  switch (reason.kind) {
    case "fresh":
      return null;
    case "replay":
      return phase === "idle"
        ? null
        : `Replaying. This puzzle has aired on this channel before, because no unplayed puzzle was available. Approve more words so a new one can be built.${poolLine(pool)}`;
    case "noReady":
      return `Idle. There are no ready puzzles: approve more words so one can be built.${poolLine(pool)}`;
    case "noFamilyFriendly":
      return `Idle. This channel plays family-friendly puzzles only and none of the ready ones are: tag more words and clues family friendly and approve them, or turn the setting off.${poolLine(pool)}`;
  }
}

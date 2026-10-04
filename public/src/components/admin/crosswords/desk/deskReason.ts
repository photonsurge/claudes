/**
 * Why a crossword channel is idle or replaying (docs/crossword-mode-plan.md
 * §7.5). The worker stores no reason, so the Desk derives one from the ready
 * stock and the channel's config; replace this one function when a structured
 * reason lands on the state.
 */
import { DEFAULT_CROSSWORD_CONFIG, type CrosswordPhase } from "@photonsurge/shared/crossword";
import type { PuzzleRow } from "../puzzles/api";

export interface DeskReasonInput {
  phase: CrosswordPhase;
  sceneId: string;
  /** Title of the puzzle on air (the state carries no id). */
  title: string;
  /** All puzzles; only `ready` ones count. */
  puzzles: PuzzleRow[];
  /** The channel's config; defaults apply while it is unknown. */
  config?: { familyFriendlyOnly: boolean; noRepeatPuzzles: number } | null;
}

export function deskReason({ phase, sceneId, title, puzzles, config }: DeskReasonInput): string | null {
  const ffOnly = config?.familyFriendlyOnly ?? DEFAULT_CROSSWORD_CONFIG.familyFriendlyOnly;
  const noRepeat = config?.noRepeatPuzzles ?? DEFAULT_CROSSWORD_CONFIG.noRepeatPuzzles;
  const playsHere = (p: PuzzleRow) => p.playLog.filter((x) => x.sceneId === sceneId);

  if (phase !== "idle") {
    // The puzzle on air counts one play itself; a second means it aired here before.
    const current = puzzles.find((p) => p.status === "ready" && p.title === title);
    if (current && playsHere(current).length >= 2) {
      return "Replaying. This puzzle has aired on this channel before, because no unplayed puzzle was available. Approve more words so a new one can be built.";
    }
    return null;
  }

  const ready = puzzles.filter((p) => p.status === "ready");
  if (!ready.length) return "Idle. There are no ready puzzles: approve more words so one can be built.";
  const eligible = ffOnly ? ready.filter((p) => p.familyFriendly) : ready;
  if (!eligible.length) {
    return "Idle. This channel plays family-friendly puzzles only and none of the ready ones are: tag more words and clues family friendly and approve them, or turn the setting off.";
  }
  if (eligible.some((p) => !playsHere(p).length)) return null;
  const recent = new Set(
    puzzles
      .flatMap((p) => playsHere(p).map((x) => ({ id: p.id, at: x.startedAt })))
      .sort((a, b) => b.at - a.at)
      .slice(0, noRepeat)
      .map((x) => x.id),
  );
  if (eligible.every((p) => recent.has(p.id))) {
    return `Idle. Every ready puzzle was played on this channel within its last ${noRepeat} puzzles (the no-repeat window). Approve more words so a new one can be built, or shorten the window.`;
  }
  return null;
}

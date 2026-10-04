"use client";

/**
 * The crossword counterpart of ChannelNowNext for the home cards (plan §8.1): a
 * crossword channel has no director shots, so its card shows the puzzle on air
 * and how far through it is — "Puzzle 42 · 7 of 14 solved".
 *
 * It reads the public projection from /api/crossword/:id/state on a slow poll.
 * That route takes the watch token or an admin session, so the operator
 * launcher gets the line and an anonymous visitor's card fails soft: any failed
 * read renders nothing rather than an error.
 */
import { useEffect, useState } from "react";
import type { CrosswordPublicState } from "@photonsurge/shared/crossword";

/** The home page is a glance, not the game: a slow poll is plenty. */
const POLL_MS = 20_000;

export type PuzzleProgress = { puzzleNo: number; solved: number; total: number };

/** The line's numbers from a public state; null when no puzzle is laid out yet. */
export function puzzleProgress(state: Pick<CrosswordPublicState, "puzzleNo" | "entries"> | null): PuzzleProgress | null {
  if (!state || !Array.isArray(state.entries) || state.entries.length === 0) return null;
  return {
    puzzleNo: state.puzzleNo,
    solved: state.entries.filter((e) => !!e.solved).length,
    total: state.entries.length,
  };
}

/** The scene's puzzle progress, or null when there is none or it can't be read. */
export function useCrosswordProgress(sceneId: string): PuzzleProgress | null {
  const [progress, setProgress] = useState<PuzzleProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/crossword/${encodeURIComponent(sceneId)}/state`, { cache: "no-store" });
        const next = res.ok ? puzzleProgress((await res.json()) as CrosswordPublicState) : null;
        if (!cancelled) setProgress(next);
      } catch {
        if (!cancelled) setProgress(null);
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [sceneId]);

  return progress;
}

export default function ChannelPuzzleLine({ sceneId }: { sceneId: string }) {
  const progress = useCrosswordProgress(sceneId);
  if (!progress) return null;
  return (
    <div style={{ fontSize: 13, color: "#c9d1e0", marginBottom: 10 }}>
      <span style={{ fontSize: 11, letterSpacing: 1, color: "#8b95a7", marginRight: 6 }}>NOW</span>
      Puzzle {progress.puzzleNo} · {progress.solved} of {progress.total} solved
    </div>
  );
}

"use client";

/**
 * The Desk's view of a channel's game: GET /api/crossword/:scene/state (the
 * same public projection the watch page draws), polled every 2 s. The Desk is
 * one operator tab, so a poll is simpler than the watch page's socket resync
 * and costs one small Mongo read. `skew` is the server clock minus ours, so
 * countdowns read right on a box whose clock drifts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CrosswordPublicState } from "@photonsurge/shared/crossword";
import { stateUrl } from "../puzzles/api";

export const DESK_POLL_MS = 2_000;

export function useDeskState(sceneId: string): {
  state: CrosswordPublicState | null;
  error: string | null;
  skew: number;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<CrosswordPublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skew, setSkew] = useState(0);
  const seq = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(stateUrl(sceneId), { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      const next = body as CrosswordPublicState;
      setError(null);
      setSkew(next.serverNow - Date.now());
      // Same seq is the same game state; only the server clock moved.
      if (seq.current === next.seq) return;
      seq.current = next.seq;
      setState(next);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, [sceneId]);

  useEffect(() => {
    seq.current = null;
    refresh();
    const t = setInterval(refresh, DESK_POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { state, error, skew, refresh };
}

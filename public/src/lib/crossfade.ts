"use client";

/**
 * Smooth transitions between successive scalar-variable values (e.g. the
 * map's `activeVariable`) instead of a hard cut — used by the ocean
 * depth-cycle scene (surface→abyss every ~2.5s) so the flip reads as one
 * continuous "probe going deeper" motion. Globe.tsx's raster-switch today is
 * a genuine hard cut: the deck.gl layer `id` embeds the variable id, so a
 * new value mounts a brand-new layer and drops the old one instantly.
 *
 * While a fade is in progress, render BOTH `from` (fading out) and `to`
 * (fading in), opacity scaled by `1 - progress` / `progress`.
 */
import { useEffect, useRef, useState } from "react";

export interface CrossfadeState {
  /** The previous value, still fading out — null once the fade settles. */
  from: string | null;
  to: string;
  /** 0 at fade start, 1 once settled on `to`. */
  progress: number;
}

/**
 * Step cadence for the fade tick. Deliberately a bounded interval, NOT
 * requestAnimationFrame: each tick here drives a full Globe.tsx deck.gl
 * layer-stack rebuild (basemap, wind, tracks, alerts, everything), so a
 * 60fps loop would rebuild that whole stack ~40 times over a 700ms fade for
 * no visible benefit — this cadence still reads as smooth.
 */
const STEP_MS = 60;

export function clampProgress(elapsedMs: number, fadeMs: number): number {
  if (fadeMs <= 0) return 1;
  return Math.max(0, Math.min(1, elapsedMs / fadeMs));
}

/** Tracks a fade from the previous `value` to the current one. */
export function useCrossfadeVariable(value: string | null | undefined, fadeMs = 700): CrossfadeState {
  const current = value ?? "";
  const [state, setState] = useState<CrossfadeState>({ from: null, to: current, progress: 1 });
  const prevRef = useRef(current);

  useEffect(() => {
    if (current === prevRef.current) return;
    const from = prevRef.current;
    prevRef.current = current;
    const startedAt = Date.now();
    setState({ from, to: current, progress: 0 });
    const t = setInterval(() => {
      const progress = clampProgress(Date.now() - startedAt, fadeMs);
      setState({ from: progress >= 1 ? null : from, to: current, progress });
      if (progress >= 1) clearInterval(t);
    }, STEP_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, fadeMs]);

  return state;
}

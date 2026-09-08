"use client";

/**
 * Smooth transitions between successive scalar-variable values (e.g. the
 * map's `activeVariable`) instead of a hard cut — used by the ocean
 * depth-cycle scene (surface→abyss every ~2.5s) and by every map-type cut of
 * the global spin tour. Globe.tsx's raster-switch on its own is a genuine hard
 * cut: the deck.gl layer `id` embeds the variable id, so a new value mounts a
 * brand-new layer and drops the old one instantly.
 *
 * While a fade is in progress, Globe renders BOTH `from` (fading out) and `to`
 * (fading in). The fade itself is drawn on the GPU: each layer carries a
 * BreatheExtension `ramp` from `startedAt` over `fadeMs`, so this hook never
 * ticks — it records the start and clears `from` once the fade has settled.
 * (An earlier version stepped a `progress` value every 60 ms, and every step
 * rebuilt and re-diffed the whole deck layer stack.)
 */
import { useEffect, useRef, useState } from "react";

export interface CrossfadeState {
  /** The previous value, still fading out — null once the fade settles. */
  from: string | null;
  to: string;
  /** Wall-clock ms the current fade started (0 when never faded). */
  startedAt: number;
  fadeMs: number;
}

export function clampProgress(elapsedMs: number, fadeMs: number): number {
  if (fadeMs <= 0) return 1;
  return Math.max(0, Math.min(1, elapsedMs / fadeMs));
}

/** Tracks a fade from the previous `value` to the current one. */
export function useCrossfadeVariable(value: string | null | undefined, fadeMs = 700): CrossfadeState {
  const current = value ?? "";
  const [state, setState] = useState<CrossfadeState>({ from: null, to: current, startedAt: 0, fadeMs });
  const prevRef = useRef(current);

  useEffect(() => {
    if (current === prevRef.current) return;
    const from = prevRef.current;
    prevRef.current = current;
    const startedAt = Date.now();
    setState({ from, to: current, startedAt, fadeMs });
    // One timeout to settle; the GPU ramp draws every frame in between.
    const t = setTimeout(() => setState({ from: null, to: current, startedAt, fadeMs }), Math.max(0, fadeMs));
    return () => clearTimeout(t);
  }, [current, fadeMs]);

  return state;
}

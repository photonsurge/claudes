"use client";

import { useEffect, useState } from "react";

/** The reference composition size the chrome is laid out at (broadcast 1080p). */
export const STAGE_W = 1920;
export const STAGE_H = 1080;

/**
 * Uniform scale to fit the STAGE_W×STAGE_H design stage into the current
 * viewport — the broadcast pattern. Chrome is authored once at 1080p and scaled
 * as a whole, so it stays pixel-proportional at any output resolution (720p →
 * 4K) instead of reflowing. `contain` (min of the two ratios) so nothing clips;
 * a true 16:9 viewport fills exactly. SSR-safe (starts 1, corrects on mount).
 */
export function useStageScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const compute = () =>
      setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return scale;
}

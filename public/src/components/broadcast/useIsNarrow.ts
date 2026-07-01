"use client";

import { useEffect, useState } from "react";

/**
 * True when the viewport is at/under `px` wide — the broadcast frame uses this to
 * drop the heaviest panels and shrink type on phones. SSR-safe (starts false,
 * corrects on mount).
 */
export function useIsNarrow(px = 640): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return narrow;
}

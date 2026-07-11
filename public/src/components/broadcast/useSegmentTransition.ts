import { useEffect, useRef, useState } from "react";

/**
 * True while the broadcast is mid-cut — from the instant the on-air segment
 * changes until the director's camera fly has landed. In watch/director mode the
 * globe flies to the next shot over `state.cutTransitionMs` (the exact duration
 * Globe's runFlight uses for a director cut); during that window the on-air left
 * deck would otherwise sit frozen showing the previous card, or flash the new
 * one's content while the camera is still travelling. Gating on this lets the
 * deck hide for the move and fade back in once the new shot settles.
 *
 * Read the duration fresh via a ref so a mid-flight `cutTransitionMs` change
 * (operator retune) doesn't reset the in-progress hold; the effect keys only on
 * the segment id, so it fires once per cut.
 */
export function useSegmentTransition(
  segmentId: string | null,
  cutTransitionMs: number | undefined,
): boolean {
  const [moving, setMoving] = useState(false);
  const prev = useRef<string | null>(segmentId);
  const holdRef = useRef<number | undefined>(cutTransitionMs);
  holdRef.current = cutTransitionMs;

  useEffect(() => {
    if (segmentId === prev.current) return;
    prev.current = segmentId;
    // Manual operator flies carry cutTransitionMs = 0 — still hold a brief beat so
    // the swap isn't a hard pop; clamp so a stray huge value can't strand it hidden.
    const hold = Math.min(Math.max(holdRef.current ?? 0, 350), 6000);
    setMoving(true);
    const id = setTimeout(() => setMoving(false), hold);
    return () => clearTimeout(id);
  }, [segmentId]);

  return moving;
}

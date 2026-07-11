"use client";

/**
 * Fades its subtree out and back in around a `hidden` pulse, holding the LAST
 * visible content frozen while hidden and only swapping to the latest children
 * behind the fade. Used to hide the on-air deck across a director cut: the
 * previous card fades out (its content, not the next one's snapping in), the
 * segment swaps unseen while the globe flies, and the new card fades in once the
 * shot settles.
 *
 * The frozen snapshot is captured in an effect (post-commit) so a concurrent,
 * uncommitted render can't pollute it; the outer div is a stable node so its
 * `opacity` genuinely CSS-transitions rather than remounting.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export default function FadeSwap({
  hidden,
  duration = 320,
  style,
  children,
}: {
  /** Fade the subtree out (and freeze it) while true; fade the latest in when false. */
  hidden: boolean;
  /** Fade length, ms — for a clean out-fade keep it under the caller's hide hold. */
  duration?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // The last children committed while visible — what we keep showing (fading out)
  // once `hidden` flips, since the live `children` have already become the next
  // segment's card by then.
  const frozen = useRef<ReactNode>(children);
  useEffect(() => {
    if (!hidden) frozen.current = children;
  });

  const content = hidden ? frozen.current : children;

  return (
    <div style={{ ...style, opacity: hidden ? 0 : 1, transition: `opacity ${duration}ms ease` }}>
      {content}
    </div>
  );
}

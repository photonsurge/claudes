"use client";

/**
 * A scroll region that gently auto-scrolls its content top → bottom → top on a
 * loop whenever it overflows. The on-air deck body is pointer-inert (the viewer
 * can't scroll by hand in OBS), so an overlong slide would otherwise just clip;
 * this walks it into view. Content that fits sits still, pinned at the top.
 *
 * JS-driven (rAF) rather than a CSS keyframe because the travel distance is the
 * runtime overflow amount, not known ahead of time. The container is
 * `overflow: hidden` — still programmatically scrollable via `scrollTop`, so no
 * scrollbar shows on air.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export default function AutoScroll({
  children,
  style,
  /** Downward travel speed, px/sec. */
  speed = 34,
  /** Hold, in ms, at the top and bottom of the loop. */
  pause = 1600,
  /** Whether this is the on-air slide. When false the region sits pinned at the
   *  top and doesn't animate (so a slide waiting off-screen in the deck can't
   *  drift down before it airs); each time it flips true the cycle restarts from
   *  the top — so a slide always loads scrolled to the top. Default true for
   *  standalone use. */
  active = true,
}: {
  children: ReactNode;
  style?: CSSProperties;
  speed?: number;
  pause?: number;
  active?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Off-screen slide: pin to the top and don't run the loop.
    if (!active) {
      el.scrollTop = 0;
      return;
    }
    if (typeof requestAnimationFrame !== "function") return;
    // Fresh cycle on (re)activation — start pinned at the top with the read hold.
    el.scrollTop = 0;

    let raf = 0;
    let last = 0;
    let phase: "holdTop" | "down" | "holdBottom" | "up" = "holdTop";
    let waited = 0;

    const step = (t: number) => {
      const dt = last ? t - last : 0;
      last = t;
      const overflow = el.scrollHeight - el.clientHeight;

      if (overflow <= 4) {
        // Fits (or not yet laid out) — keep it pinned to the top, reset cycle.
        if (el.scrollTop !== 0) el.scrollTop = 0;
        phase = "holdTop";
        waited = 0;
      } else if (phase === "holdTop") {
        waited += dt;
        if (waited >= pause) (waited = 0), (phase = "down");
      } else if (phase === "down") {
        el.scrollTop = Math.min(overflow, el.scrollTop + (speed * dt) / 1000);
        if (el.scrollTop >= overflow - 0.5) phase = "holdBottom";
      } else if (phase === "holdBottom") {
        waited += dt;
        if (waited >= pause) (waited = 0), (phase = "up");
      } else {
        // Glide back up a touch faster than the read-down.
        el.scrollTop = Math.max(0, el.scrollTop - (speed * 1.7 * dt) / 1000);
        if (el.scrollTop <= 0.5) phase = "holdTop";
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [speed, pause, active]);

  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}

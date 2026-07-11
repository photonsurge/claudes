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
}: {
  children: ReactNode;
  style?: CSSProperties;
  speed?: number;
  pause?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof requestAnimationFrame !== "function") return;

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
  }, [speed, pause]);

  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}

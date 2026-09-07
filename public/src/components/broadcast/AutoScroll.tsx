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
 *
 * The overflow is MEASURED only on (re)activation and when the box or its
 * content changes (ResizeObserver + MutationObserver), never per frame: reading
 * `scrollHeight` forces a synchronous layout of the whole document, and doing
 * that every frame right after the other overlays' style writes was one of the
 * larger fixed costs on the /watch main thread. The scroll position is tracked
 * locally and only written while actually moving.
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

    let overflow = 0;
    let dirty = true;
    const measure = () => {
      dirty = false;
      overflow = el.scrollHeight - el.clientHeight;
    };
    const markDirty = () => {
      dirty = true;
    };
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(markDirty) : null;
    ro?.observe(el);
    const mo = typeof MutationObserver === "function" ? new MutationObserver(markDirty) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    // Fonts/images landing after mount change the content height without a DOM
    // mutation — re-measure once they've had a moment.
    const settle = setTimeout(markDirty, 600);

    let raf = 0;
    let last = 0;
    let pos = 0;
    let phase: "holdTop" | "down" | "holdBottom" | "up" = "holdTop";
    let waited = 0;

    const step = (t: number) => {
      const dt = last ? t - last : 0;
      last = t;
      if (dirty) measure();

      if (overflow <= 4) {
        // Fits (or not yet laid out) — keep it pinned to the top, reset cycle.
        if (pos !== 0) {
          pos = 0;
          el.scrollTop = 0;
        }
        phase = "holdTop";
        waited = 0;
      } else if (phase === "holdTop") {
        waited += dt;
        if (waited >= pause) (waited = 0), (phase = "down");
      } else if (phase === "down") {
        pos = Math.min(overflow, pos + (speed * dt) / 1000);
        el.scrollTop = pos;
        if (pos >= overflow - 0.5) phase = "holdBottom";
      } else if (phase === "holdBottom") {
        waited += dt;
        if (waited >= pause) (waited = 0), (phase = "up");
      } else {
        // Glide back up a touch faster than the read-down.
        pos = Math.max(0, pos - (speed * 1.7 * dt) / 1000);
        el.scrollTop = pos;
        if (pos <= 0.5) phase = "holdTop";
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [speed, pause, active]);

  return (
    <div ref={ref} style={style}>
      {children}
    </div>
  );
}

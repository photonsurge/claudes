"use client";

/**
 * A scroll region that gently auto-scrolls its content top → bottom → top on a
 * loop whenever it overflows. The on-air deck body is pointer-inert (the viewer
 * can't scroll by hand in OBS), so an overlong slide would otherwise just clip;
 * this walks it into view. Content that fits sits still, pinned at the top.
 *
 * JS-driven (rAF) rather than a CSS keyframe because the travel distance is the
 * runtime overflow amount, not known ahead of time.
 *
 * Speed is not a constant: it is derived from the CONTENT (shared/reading-pace)
 * so the text passes the window at the channel's reading pace — a dense
 * paragraph creeps, a short list moves on, and neither outruns the viewer. The
 * character count comes off `textContent` (a tree read, never a layout) and the
 * content height off the same ResizeObserver as the overflow, so it re-paces
 * itself for free whenever the slide's body changes. `speed` still forces a
 * fixed px/s where a caller really wants one.
 *
 * Moves the content with a `transform` on an inner wrapper — NOT `scrollTop`.
 * Reading `scrollHeight` (or writing `scrollTop`, which must clamp against
 * current layout) forces a synchronous layout of the whole document whenever
 * anything has dirtied it that frame; on /watch that was a ~5 ms hit every
 * single frame. A transform is compositor-only. The overflow is measured from
 * ResizeObserver entries (they arrive after layout — nothing is forced) for
 * both the box and the content, so it tracks late fonts/images and slide
 * content changes for free.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { scrollPxPerSec } from "@photonsurge/shared/reading-pace";
import { useReadPace } from "./pace-context";

export default function AutoScroll({
  children,
  style,
  /** Fixed downward travel speed, px/sec. Omitted (the norm): paced from the
   *  content's own length at the channel's reading pace. */
  speed,
  /** Hold, in ms, at the top and bottom of the loop. */
  pause = 1600,
  /** Whether this is the on-air slide. When false the region sits pinned at the
   *  top and doesn't animate (so a slide waiting off-screen in the deck can't
   *  drift down before it airs); each time it flips true the cycle restarts from
   *  the top — so a slide always loads scrolled to the top. Default true for
   *  standalone use. */
  active = true,
  cps,
}: {
  children: ReactNode;
  style?: CSSProperties;
  speed?: number;
  pause?: number;
  active?: boolean;
  /** Reading-pace override, characters/sec (default: the channel's). */
  cps?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pace = useReadPace(cps);

  useEffect(() => {
    const el = ref.current;
    const inner = innerRef.current;
    if (!el || !inner) return;
    // Fresh cycle on (re)activation — start pinned at the top with the read hold.
    inner.style.transform = "translate3d(0, 0, 0)";
    // Off-screen slide: pin to the top and don't run the loop.
    if (!active) return;
    if (typeof requestAnimationFrame !== "function") return;

    // Sizes come from the ResizeObserver only: it delivers both boxes' initial
    // sizes right after the next layout, so nothing is read here. The old
    // `el.clientHeight` / `inner.offsetHeight` reads on activation forced a
    // whole-document layout inside every director cut's commit — 10–21 ms on
    // OBS's CEF, the last forced layout left in a cut (docs/watch-perf-plan.md,
    // round 53). Until the observer reports, the region reads as "fits" and
    // stays pinned at the top, which is where a fresh slide starts anyway.
    let boxH = 0;
    let contentH = 0;
    // Characters in the body — read off the DOM tree (no layout) whenever the
    // content's box changes, which is every time the slide's body changes.
    let chars = inner.textContent?.length ?? 0;
    const ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            for (const e of entries) {
              const height = e.contentRect.height;
              if (e.target === el) boxH = height;
              else if (e.target === inner) {
                contentH = height;
                chars = inner.textContent?.length ?? 0;
              }
            }
          })
        : null;
    ro?.observe(el);
    ro?.observe(inner);

    let raf = 0;
    let last = 0;
    let pos = 0;
    let phase: "holdTop" | "down" | "holdBottom" | "up" = "holdTop";
    let waited = 0;
    const write = () => {
      inner.style.transform = `translate3d(0, ${(-pos).toFixed(2)}px, 0)`;
    };

    const step = (t: number) => {
      const dt = last ? t - last : 0;
      last = t;
      const overflow = contentH - boxH;
      // Re-derived each frame: contentH/chars only change when the body does,
      // and this is a couple of multiplies against a rAF that is running anyway.
      const pxPerSec = speed ?? scrollPxPerSec(contentH, chars, pace);

      if (overflow <= 4) {
        // Fits (or not yet laid out) — keep it pinned to the top, reset cycle.
        if (pos !== 0) {
          pos = 0;
          write();
        }
        phase = "holdTop";
        waited = 0;
      } else if (phase === "holdTop") {
        waited += dt;
        if (waited >= pause) (waited = 0), (phase = "down");
      } else if (phase === "down") {
        pos = Math.min(overflow, pos + (pxPerSec * dt) / 1000);
        write();
        if (pos >= overflow - 0.5) phase = "holdBottom";
      } else if (phase === "holdBottom") {
        waited += dt;
        if (waited >= pause) (waited = 0), (phase = "up");
      } else {
        // Glide back up a touch faster than the read-down.
        pos = Math.max(0, pos - (pxPerSec * 1.7 * dt) / 1000);
        write();
        if (pos <= 0.5) phase = "holdTop";
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [speed, pause, active, pace]);

  return (
    <div ref={ref} style={{ ...style, overflow: "hidden" }}>
      <div ref={innerRef} style={{ willChange: active ? "transform" : undefined }}>
        {children}
      </div>
    </div>
  );
}

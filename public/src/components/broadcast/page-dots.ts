/**
 * The GODS page indicator: a row of small squares with the active one stretched.
 * It used to animate `width`, a LAYOUT property — every page flip cost ~9 frames
 * of whole-page layout (~1.6 ms each in OBS's CEF; docs/watch-perf-plan.md,
 * round 17). The same picture and the same motion, expressed as transforms:
 * every square keeps its small layout box, the active one scales from its left
 * edge, squares after it slide over by the extra width, and the row is given
 * that width as slack on its trailing side so its footprint (and right-aligned
 * edge) is exactly where the reflowing version put it.
 *
 * Motion matches too: `width` and `transform` both ease over the same duration;
 * a square handing over the active role goes scaleX(k) → translateX(extra),
 * which interpolates as shrink-while-sliding with a fixed right edge — what
 * the reflow did to it when the square before it grew.
 */
import type { CSSProperties } from "react";

export function pageDotStyle(
  i: number,
  active: number,
  size: number,
  activeWidth: number,
  accent: string,
  border: string,
  ms: number,
): CSSProperties {
  const extra = activeWidth - size;
  return {
    width: size,
    height: size,
    background: i === active ? accent : border,
    transformOrigin: "left center",
    transform: i === active ? `scaleX(${activeWidth / size})` : i > active ? `translateX(${extra}px)` : "none",
    transition: `transform ${ms}ms ease, background ${ms}ms ease`,
  };
}

/** Trailing slack the row needs so the stretched square stays inside its footprint. */
export function pageDotsSlack(size: number, activeWidth: number): number {
  return activeWidth - size;
}

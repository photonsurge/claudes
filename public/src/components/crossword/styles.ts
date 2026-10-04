/**
 * Shared furniture for the crossword watch page: the frame size, the flat
 * plate, the ink tokens (the theme's CSS vars, set once on the frame root by
 * CrosswordWatch) and the few keyframes the solve effects use.
 *
 * House rules: plates are flat (no shadow, no blur, no gradient wash under
 * them), every colour is a theme token, and every motion is a CSS animation
 * that runs once. Nothing here needs a frame loop.
 */
import type { CSSProperties } from "react";
import { GODS_BORDER, GODS_FILL, GODS_TILE, GODS_TILE_BORDER, INK, TEXT_INK, INK_DIM, INK_FAINT, SANS, MONO } from "../broadcast/GodsPanel";

export { INK, TEXT_INK, INK_DIM, INK_FAINT, GODS_TILE, GODS_TILE_BORDER, SANS, MONO };

/** The page is laid out on a 1920×1080 stage and scaled to the window. */
export const FRAME_W = 1920;
export const FRAME_H = 1080;

/** Accent and live inks: theme tokens, set on the frame root. */
export const ACCENT = "var(--gods-accent, #4dc8ff)";
export const LIVE = "var(--cw-live, #ff3b3b)";

/** The flat plate every card sits on. */
export const PLATE: CSSProperties = {
  background: GODS_FILL,
  border: `1px solid ${GODS_BORDER}`,
  borderRadius: 6,
  boxSizing: "border-box",
};

/** Eyebrow caption over a card ("NOW SOLVING", "ACROSS"). */
export const EYEBROW: CSSProperties = {
  color: ACCENT,
  fontFamily: SANS,
  fontSize: 18,
  fontWeight: 600,
  letterSpacing: 3,
  textTransform: "uppercase",
};

/**
 * cwLand: a letter dropping into its cell. cwFlash: the brief highlight over a
 * word that was just solved (ends transparent, so the overlay can stay
 * mounted). cwDrain: the countdown bar, from `--cw-from` down to empty.
 */
export const KEYFRAMES = `@keyframes cwLand{0%{opacity:0;transform:translateY(-40%) scale(1.5)}60%{opacity:1}100%{opacity:1;transform:none}}
@keyframes cwFlash{0%{opacity:.9}100%{opacity:0}}
@keyframes cwDrain{from{transform:scaleX(var(--cw-from,1))}to{transform:scaleX(0)}}
@media (prefers-reduced-motion: reduce){[data-cw-anim]{animation:none !important}}`;

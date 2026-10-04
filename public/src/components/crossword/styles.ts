/**
 * Shared furniture for the crossword page: the frame size, the flat
 * plate, the ink tokens (the theme's --cw-* CSS vars, set once on the page root by
 * CrosswordPage) and the few keyframes the solve effects use.
 *
 * House rules: plates are flat (no shadow, no blur, no gradient wash under
 * them), every colour is a theme token, and every motion is a CSS animation
 * that runs once. Nothing here needs a frame loop.
 */
import type { CSSProperties } from "react";

/** The theme's CSS variables (crosswordThemeVars), set once on the page root by CrosswordPage. */
export const INK = "var(--cw-ink)";
export const TEXT_INK = INK;
export const INK_DIM = "var(--cw-ink-muted)";
export const INK_FAINT = "color-mix(in srgb, var(--cw-ink-muted) 65%, transparent)";
export const CELL = "var(--cw-cell)";
export const CELL_SOLVED = "var(--cw-cell-solved)";
export const BLOCK = "var(--cw-block)";
/** Hairline between cells and around plates: the ink, faint. */
export const LINE = "color-mix(in srgb, var(--cw-ink) 22%, transparent)";
export const SANS = "var(--cw-font-text)";
export const DISPLAY = "var(--cw-font-display)";
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** The page is laid out on a 1920×1080 stage and scaled to the window. */
export const FRAME_W = 1920;
export const FRAME_H = 1080;

/** Accent ink: a theme token. */
export const ACCENT = "var(--cw-accent)";
export const LIVE = ACCENT;

/** The flat plate every card sits on. */
export const PLATE: CSSProperties = {
  background: "var(--cw-panel)",
  border: `1px solid ${LINE}`,
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

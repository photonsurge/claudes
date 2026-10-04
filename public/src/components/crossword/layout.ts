/**
 * The crossword frame's measurements (1920×1080 stage) and the clue list's
 * font rule, in one place so the components and the fit test share them.
 */
export const FRAME_W = 1920;
export const FRAME_H = 1080;
export const PAD = 24;
export const GAP = 20;
export const HEADER_H = 72;
export const FOOTER_H = 64;
export const BODY_TOP = PAD + HEADER_H + GAP;
export const BODY_H = FRAME_H - BODY_TOP - GAP - FOOTER_H - PAD;
/** 13 columns of 56 px cells plus padding. */
export const GRID_COL_W = 760;
export const GRID_PAD = 12;
export const RIGHT_X = PAD + GRID_COL_W + PAD;
export const RIGHT_W = FRAME_W - RIGHT_X - PAD;
export const RIGHT_GAP = 16;
export const SPOT_H = 212;
export const BOTTOM_H = 160;
export const MAX_CELL = 64;

// Clue list plate: padding, column gap, eyebrow (18 px caption + gap).
export const ROW_GAP = 4;
export const LIST_PAD_X = 20;
export const LIST_PAD_Y = 14;
export const LIST_COL_GAP = 24;
export const LIST_EYEBROW_H = 22 + 10 + ROW_GAP;
export const LIST_H = BODY_H - SPOT_H - BOTTOM_H - RIGHT_GAP * 2;
/** Rows per scoreboard / feed table in the bottom plate. */
export const BOTTOM_ROWS = 3;

/** Caps from the plan (§7.1, §7.3): the longest clue the list must hold. */
export const CLUE_MAX_CHARS = 48;
/** Average glyph width as a share of the font size; deliberately generous. */
const GLYPH_W = 0.55;
const MIN_FONT = 12;
const MAX_FONT = 24;

/** Width the clue text gets in one column at font size `f` (number column and left rule out). */
export const clueTextWidth = (f: number) =>
  (RIGHT_W - LIST_PAD_X * 2 - LIST_COL_GAP) / 2 - 3 - 8 - 10 - f * 1.3;

/** Height of one row: the clue (1 or 2 lines by its width) plus the credit line. */
export function clueRowHeight(f: number): number {
  const chars = CLUE_MAX_CHARS + 4; // " (n)"
  const lines = Math.min(2, Math.ceil((chars * GLYPH_W * f) / clueTextWidth(f)));
  return Math.ceil(lines * f * 1.2 + f * 0.8 * 1.25) + ROW_GAP;
}

/** Height the list's rows need for `rows` clues in a column at font size `f`. */
export const clueColumnHeight = (rows: number, f: number) => rows * clueRowHeight(f);

/** Height left for rows inside the list plate. */
export const LIST_CONTENT_H = LIST_H - LIST_PAD_Y * 2 - LIST_EYEBROW_H;

/** The biggest font (24 down to 12 px) at which `rows` worst-case clues fit one column. */
export function clueFontSize(rows: number): number {
  for (let f = MAX_FONT; f > MIN_FONT; f--) if (clueColumnHeight(rows, f) <= LIST_CONTENT_H) return f;
  return MIN_FONT;
}

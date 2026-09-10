/**
 * The app's font stacks, in one place.
 *
 * Every stack that can ever carry text leads with the self-hosted flag face
 * (see public/src/app/globals.css). Country flags are regional-indicator emoji,
 * so they only draw if the machine running the browser owns a font covering
 * U+1F1E6-1F1FF — desktop Chrome does, the Chromium inside OBS on the encoder
 * host does not, and every flag on air came out as two .notdef boxes. The face
 * declares `unicode-range: U+1F1E6-1F1FF`, so it is consulted for flags ONLY
 * and never changes how ordinary text renders.
 *
 * `Saira` and `JetBrains Mono` are absent here on purpose: globals.css extends
 * those two families with the same flag glyphs under their own names, so
 * GodsPanel's SANS/MONO already pick them up.
 */

/** The self-hosted flags-only face. Lead every stack with it. */
export const FLAG_FAMILY = '"Noto Color Emoji Flags"';

/** The default UI stack (the old `system-ui, sans-serif`) plus flag coverage. */
export const UI_SANS = `${FLAG_FAMILY}, system-ui, sans-serif`;

/** The monospace UI stack (readouts, debug overlays) plus flag coverage. */
export const UI_MONO = `${FLAG_FAMILY}, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

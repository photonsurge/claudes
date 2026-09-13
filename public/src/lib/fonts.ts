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

/**
 * The broadcast type ramp: the banner's Saira / JetBrains Mono, led by the flag
 * face. Re-exported by GodsPanel as SANS / MONO, which is what the on-air chrome
 * actually writes into `fontFamily`.
 *
 * LEADING with the flag family is the whole point, and it replaces an earlier
 * fix that looked equivalent and was not. That one re-declared `Saira` and
 * `JetBrains Mono` in globals.css over the flag unicode-range, on the theory
 * that same-name @font-face rules merge into one family and Blink then picks
 * per character. It works on a page where we are the only one declaring those
 * names. It does NOT work on ours, because the Google Fonts stylesheet declares
 * the same two families at exact weights (300/400/500/600): Blink matches the
 * weight first, lands on Google's latin face, finds no flag glyph in it, and
 * moves to the NEXT FAMILY in the stack rather than to our face in the same
 * family. Our faces were never even fetched, and every flag on air was two
 * .notdef boxes while `document.fonts` cheerfully listed the face as declared.
 *
 * Leading the stack sidesteps the whole question. `unicode-range` means this
 * family is only ever consulted for U+1F1E6-1F1FF and declines everything else,
 * so Saira still draws all the actual text, byte for byte.
 */
export const BRAND_SANS = `${FLAG_FAMILY}, Saira, 'Helvetica Neue', Helvetica, sans-serif`;

/** The mono half of the broadcast ramp. Same rule: flag face first. */
export const BRAND_MONO = `${FLAG_FAMILY}, 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`;

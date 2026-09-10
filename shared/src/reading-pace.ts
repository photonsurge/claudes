/**
 * On-air READING PACE — the one number every scrolling surface on /watch sizes
 * itself from: the bottom crawl, the WORLD REPORT row marquee and the deck
 * cards' auto-scrolling bodies.
 *
 * The pace is expressed in CHARACTERS PER SECOND, not pixels per second or a
 * loop duration, because that is the thing a viewer actually has to keep up
 * with. Every surface then derives its own motion from its OWN content: a long
 * crawl feed moves at the same characters-per-second as a short one (it just
 * takes longer to come round), a dense card body scrolls slower than a sparse
 * one, and a marquee row holds for as long as that row takes to read. Nothing
 * is a fixed px/s constant tuned by eye any more.
 *
 * Where the default comes from: average silent reading is ~200 wpm across
 * languages (English non-fiction meta-analyses land nearer 238 wpm; other
 * scripts lower), and the broadcast timed-text convention caps subtitles at
 * ~17 characters a second for adults. On-air text is read ONCE, in motion,
 * off-axis, often in the viewer's second language — so the default sits
 * deliberately BELOW both: 15 cps ≈ 150 wpm.
 *
 * Per channel this is `ControlState.readPaceCps` (Reading pace on
 * /admin/scenes/:id and /control), so an operator can slow a wordy channel
 * down or speed a headline channel up without touching any of the surfaces.
 */

/** Characters in an average word, its trailing space included (~5 letters + 1). */
export const CHARS_PER_WORD = 6;

/** Reference points the default is set against (documentation, not tunables). */
export const AVERAGE_READING_WPM = 200;
export const SUBTITLE_CPS_ADULT = 17;

/** The channel default: 15 cps ≈ 150 wpm — a step slower than both references. */
export const DEFAULT_READ_CPS = 15;
/** Operator range: 5 cps ≈ 50 wpm (a very slow news crawl) … 24 cps ≈ 240 wpm. */
export const READ_CPS_MIN = 5;
export const READ_CPS_MAX = 24;

/** The paces the operator console offers in its dropdown, cps. */
export const READ_PACE_PRESETS: readonly number[] = [6, 8, 10, 12, 15, 18, 21, 24];

/** px/s bounds for a vertical auto-scroll — a creep that reads as still, and a
 *  ceiling so a one-word body can't fling itself past. */
export const SCROLL_PX_S_MIN = 3;
export const SCROLL_PX_S_MAX = 80;

/** Dwell bounds for a row marquee, ms — a row is never on for less/more than this. */
export const FEED_ROW_MS_MIN = 1200;
export const FEED_ROW_MS_MAX = 8000;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Any untrusted value → a usable pace (non-numbers and nonsense fall back to the default). */
export function clampReadCps(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_READ_CPS;
  return clamp(n, READ_CPS_MIN, READ_CPS_MAX);
}

/** The same pace as words per minute — what the settings UI shows next to the slider. */
export function readWpm(cps: number): number {
  return Math.round((clampReadCps(cps) * 60) / CHARS_PER_WORD);
}

/** Seconds a viewer needs for `chars` characters at this pace. */
export function readSeconds(chars: number, cps: number = DEFAULT_READ_CPS): number {
  return Math.max(0, chars) / clampReadCps(cps);
}

/**
 * Seconds one full pass of a crawl of `chars` characters should take: its read
 * time, floored so a very short feed (which fits the band and would otherwise
 * whip round every few seconds) still ambles.
 */
export function crawlSeconds(chars: number, cps: number = DEFAULT_READ_CPS, minSeconds = 24): number {
  return Math.max(minSeconds, readSeconds(chars, cps));
}

/**
 * Downward speed, px/s, for a block of `chars` characters laid out `contentPx`
 * tall: the text passes a fixed window at exactly the reading pace, so a dense
 * body creeps and an airy one moves on. Unmeasured content (no size or no text
 * yet) falls back to the pace over a nominal 12px line of ~50 characters.
 */
export function scrollPxPerSec(contentPx: number, chars: number, cps: number = DEFAULT_READ_CPS): number {
  const pace = clampReadCps(cps);
  if (!(contentPx > 0) || !(chars > 0)) return clamp((pace * 17) / 50, SCROLL_PX_S_MIN, SCROLL_PX_S_MAX);
  return clamp((pace * contentPx) / chars, SCROLL_PX_S_MIN, SCROLL_PX_S_MAX);
}

/**
 * How long one row of a vertical row marquee holds, ms: the time that row takes
 * to read. `avgRowChars` is the feed's mean row length, so a feed of terse
 * quake lines steps faster than one of long alert headlines.
 */
export function feedRowMs(avgRowChars: number, cps: number = DEFAULT_READ_CPS): number {
  const chars = avgRowChars > 0 ? avgRowChars : 45;
  return Math.round(clamp(readSeconds(chars, cps) * 1000, FEED_ROW_MS_MIN, FEED_ROW_MS_MAX));
}

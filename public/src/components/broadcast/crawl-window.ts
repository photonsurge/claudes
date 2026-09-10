/**
 * The crawl's window: which entries the ticker renders at a time.
 *
 * The whole feed used to be in the DOM twice (for the seamless loop) — with a
 * busy seismic feed that was ~6 900 spans, a ~150–250 ms full-page layout on
 * every content change and a per-frame compositing tax for the page's size
 * (docs/watch-perf-plan.md, round 27). Now only a segment is rendered: a HEAD
 * that scrolls out of view over the segment, then a TAIL wide enough to keep
 * the viewport full at the end of it. When the head has scrolled past, the
 * window advances by the head and the next segment starts where this one
 * ended — the tail's first entry becomes the head's, at the same pixel.
 *
 * Pure: windowing, character counts and the cycle length — which is now the
 * feed's READ TIME at the channel's reading pace (shared/reading-pace), so the
 * crawl moves at a speed a viewer can actually keep up with whatever the feed's
 * length, instead of a px/s constant tuned by eye.
 */
import { crawlSeconds, DEFAULT_READ_CPS } from "@photonsurge/shared/reading-pace";
import type { TickerEntry } from "../../lib/broadcast";

export const SEPARATOR = "❯";
export const STANDBY = "STANDING BY · AWAITING LIVE FEED";
export const entryText = (e: TickerEntry): string => (typeof e === "string" ? e : e.text);

/** The old formula joined entries with `     ❯     ` — 11 characters a gap. */
export const GAP_CHARS = 11;
/** Floor: a feed short enough to sit in the band whole would otherwise whip
 *  round every few seconds, so a cycle never runs shorter than this. */
export const MIN_CYCLE_S = 24;
/** Characters of head per segment (≈ a minute of crawl) and the tail's floor. */
export const HEAD_CHARS = 400;
export const TAIL_CHARS = 360;
/** Growth step when the measured tail turns out narrower than the viewport, and its cap. */
export const TAIL_GROWTH = 1.6;
export const MAX_TAIL_CHARS = 6000;
/** Hard cap on rendered entries per part (a feed of one-character lines). */
const MAX_PART = 400;

/** An entry with its position in the feed — index 0 draws no leading separator. */
export interface WindowEntry {
  entry: TickerEntry;
  index: number;
}

export interface CrawlWindow {
  head: WindowEntry[];
  tail: WindowEntry[];
}

/** Characters the old whole-crawl line counted for these entries, gaps included. */
export function charsOf(entries: readonly TickerEntry[]): number {
  let n = 0;
  for (const e of entries) n += entryText(e).length;
  return n + GAP_CHARS * Math.max(0, entries.length - 1);
}

/** Seconds one full cycle of the whole feed takes: its read time at `cps`
 *  characters a second, floored for tiny feeds. */
export function cycleSeconds(entries: readonly TickerEntry[], cps: number = DEFAULT_READ_CPS): number {
  return crawlSeconds(charsOf(entries), cps, MIN_CYCLE_S);
}

function take(entries: readonly TickerEntry[], from: number, minChars: number): WindowEntry[] {
  const out: WindowEntry[] = [];
  const n = entries.length;
  let i = from % n;
  let chars = 0;
  while ((chars < minChars || out.length === 0) && out.length < MAX_PART) {
    out.push({ entry: entries[i], index: i });
    chars += entryText(entries[i]).length + GAP_CHARS;
    i = (i + 1) % n;
  }
  return out;
}

/** The segment starting at feed index `start`: a head of ≥ headChars, then a tail of ≥ tailChars (wrapping). */
export function crawlWindow(entries: readonly TickerEntry[], start: number, headChars = HEAD_CHARS, tailChars = TAIL_CHARS): CrawlWindow {
  if (!entries.length) return { head: [], tail: [] };
  const head = take(entries, start, headChars);
  const tail = take(entries, start + head.length, tailChars);
  return { head, tail };
}

/** The feed index the next segment starts at. */
export function nextStart(start: number, window: CrawlWindow, count: number): number {
  return count ? (start + window.head.length) % count : 0;
}

/** Stable React keys for a rendered part — an entry's text, repeats suffixed. */
export function windowKeys(part: readonly WindowEntry[]): string[] {
  const seen = new Map<string, number>();
  return part.map(({ entry }) => {
    const text = entryText(entry);
    const n = seen.get(text) ?? 0;
    seen.set(text, n + 1);
    return n ? `${text}#${n}` : text;
  });
}

"use client";

/**
 * A broadcast crawl: an optional title chip pinned to the left and the live feed
 * scrolling seamlessly beside it. Only a window of the feed is in the DOM at a
 * time (crawl-window.ts): a head that slides out over the segment and a tail
 * that keeps the viewport full, the next segment starting where this one
 * ended, so the loop is gapless; speed is derived from content length so a
 * short feed doesn't whip past. Pure CSS animation — no rAF.
 *
 * Entries are plain strings, or `{ text, ad: true }` sponsored mentions (see
 * lib/broadcast's weaveSponsors) rendered in the accent ink behind a small AD
 * tag — clearly sponsor, never disguised as a feed line.
 */
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type AnimationEvent } from "react";
import type { TickerEntry } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import {
  charsOf,
  crawlWindow,
  cycleSeconds,
  HEAD_CHARS,
  MAX_TAIL_CHARS,
  nextStart,
  SEPARATOR,
  STANDBY,
  TAIL_CHARS,
  TAIL_GROWTH,
  windowKeys,
  type CrawlWindow,
  type WindowEntry,
} from "./crawl-window";
import { UI_SANS } from "../../lib/fonts";

/** What an entry renders as: its text, and whether it is the sponsored form. */
const entryFingerprint = (e: TickerEntry): string => (typeof e === "string" ? e : `\u0002${e.text}`);

/** The placeholder feed, one identity so a segment cut from it is recognisable. */
const STANDBY_ENTRIES: TickerEntry[] = [STANDBY];

/**
 * Where the next segment starts in `feed`, given the segment that just ended.
 * The same feed: straight after the head, as always. A changed feed: at the
 * entry that was due next (the old tail's first) if the new feed still has
 * it, else at the same position modulo the new length — a line or two skipped
 * or repeated at a boundary is invisible; a rewind to the top is not.
 */
export function feedStart(start: number, window: CrawlWindow, feed: readonly TickerEntry[]): number {
  const due = window.tail[0]?.entry;
  if (due !== undefined) {
    const key = entryFingerprint(due);
    const at = feed.findIndex((e) => entryFingerprint(e) === key);
    if (at >= 0) return at;
  }
  return nextStart(start, window, feed.length);
}

/** Exported for tests: the old per-entry keys, now over a rendered window part. */
export const entryKeys = (entries: TickerEntry[]): string[] => windowKeys(entries.map((entry, index) => ({ entry, index })));

/** One part of the crawl — entries with a separator before each but the feed's first. */
function CrawlContent({ part, theme }: { part: WindowEntry[]; theme: BroadcastTheme }) {
  const keys = windowKeys(part);
  return (
    <span>
      {part.map(({ entry: e, index }, i) => (
        <Fragment key={keys[i]}>
          {index === 0 ? (
            <span style={{ display: "inline-block", width: 24 }} />
          ) : (
            <span style={{ padding: "0 20px", opacity: 0.7 }}>{SEPARATOR}</span>
          )}
          {typeof e === "string" ? (
            <span>{e}</span>
          ) : (
            <span style={{ color: theme.accent, fontWeight: 800 }}>
              <span
                style={{
                  display: "inline-block",
                  border: `1px solid ${theme.accent}`,
                  borderRadius: 3,
                  padding: "0px 4px",
                  marginRight: 8,
                  fontSize: "0.75em",
                  letterSpacing: 1.2,
                  verticalAlign: "1px",
                }}
              >
                AD
              </span>
              {e.text}
            </span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

/** The crawl's motion for one segment: how far the track slides and how long it takes. */
interface Motion {
  dist: number;
  dur: number;
}

export default function Ticker({
  title,
  items,
  edge,
  height = 30,
  compact = false,
  insetLeft = 0,
  offset = 0,
  contentInset = 0,
  theme = DEFAULT_THEME,
}: {
  /** Title chip text; null/empty renders no chip (a bare band). */
  title?: string | null;
  items: TickerEntry[];
  /** Which edge to pin to. */
  edge: "top" | "bottom";
  height?: number;
  compact?: boolean;
  /** Start the band this far from the left edge — the top crawl uses it to
   *  begin AFTER the masthead brand block instead of running underneath it. */
  insetLeft?: number;
  /** Push the band this far in from its pinned edge — the top crawl uses it to
   *  slide down beneath the masthead banner instead of hugging the very top. */
  offset?: number;
  /** Clip the crawl TEXT to start this far into the band while the band itself
   *  still spans full width — the top crawl uses it (chip-less) to run behind
   *  the masthead banner, with the text sliding out from behind the graphic's
   *  right edge instead of a hard chip terminus. Measured from the band's own
   *  left edge; meant for the chip-less mode. */
  contentInset?: number;
  theme?: BroadcastTheme;
}) {
  const rawEntries: TickerEntry[] = items.length ? items : STANDBY_ENTRIES;
  // The track feed hands the ticker a fresh array about once a second, nearly
  // always with the same lines. Everything downstream keys on `entries` — the
  // window memo and, through it, the layout measurement in the effect below —
  // so its identity has to follow the CONTENT, not the array: keyed on the
  // array, the crawl re-measured itself (two getBoundingClientRect + a
  // clientWidth read, each a forced layout) every second on air for a crawl
  // that had not changed (docs/watch-perf-plan.md, round 42).
  const feedKey = rawEntries.map(entryFingerprint).join("\u0001");
  const stable = useRef({ key: feedKey, entries: rawEntries });
  if (stable.current.key !== feedKey) stable.current = { key: feedKey, entries: rawEntries };
  const entries = stable.current.entries;
  const fontSize = compact ? 10 : 12;

  // Windowed crawl (crawl-window.ts): only the current segment is in the DOM.
  // A segment is keyed so its track remounts and its animation restarts from
  // translateX(0) — exactly where the previous segment ended, since its head
  // is the previous tail. A segment is cut from the feed AS IT STOOD when the
  // segment began (`seg.entries`); a feed that changes mid-segment is adopted
  // when the segment ends, the next head cut from the new feed at the entry
  // that was due next if the new feed still has it (see `feedStart`). Nothing
  // rewinds, remounts or re-measures mid-segment. On air the feed changes on
  // every director cut (the cut's toggles gate the alert / quake / volcano
  // lines and the on-air event's quakes join the list) and on every poll, and
  // each of those used to restart the crawl from its first entry — a forced
  // layout inside the cut's commit, a rebuilt track, and a crawl that visibly
  // jumped back to the top (docs/watch-perf-plan.md, round 50). The one feed
  // adopted at once is the first real one after standby, so a page doesn't
  // hold "STANDING BY" for a whole segment after its feed lands.
  const [seg, setSeg] = useState(() => ({ start: 0, id: 0, entries }));
  const [tailChars, setTailChars] = useState(TAIL_CHARS);
  const latest = useRef(entries);
  latest.current = entries;
  if (seg.entries === STANDBY_ENTRIES && entries !== STANDBY_ENTRIES) {
    setSeg((s) => ({ start: 0, id: s.id + 1, entries }));
  }
  const window = useMemo(() => crawlWindow(seg.entries, seg.start, HEAD_CHARS, tailChars), [seg.entries, seg.start, tailChars]);
  const [motion, setMotion] = useState<Motion | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);

  // A segment's motion is sized from its head / track / viewport widths. Those
  // come from a ResizeObserver, which reports right after the frame's own
  // layout, not from getBoundingClientRect in the effect: read there, in the
  // commit that mounted the segment, the rects forced a whole-document layout
  // of the cut's fresh DOM (30 ms) that the frame then repeated
  // (docs/watch-perf-plan.md, round 55). Nothing is lost — the crawl starts
  // on the same frame it would have. No ResizeObserver (jsdom): a static crawl.
  useLayoutEffect(() => {
    const head = headRef.current;
    const track = trackRef.current;
    const viewport = viewportRef.current;
    if (!head || !track || !viewport || typeof ResizeObserver !== "function") {
      setMotion(null);
      return;
    }
    let dist = 0;
    let total = 0;
    let width = 0;
    const size = () => {
      if (!(dist > 0)) return;
      // The tail must still fill the viewport once the head has scrolled out.
      if (total - dist < width + 40 && tailChars < MAX_TAIL_CHARS) {
        setTailChars((t) => Math.min(MAX_TAIL_CHARS, Math.ceil(t * TAIL_GROWTH)));
        return;
      }
      // The old whole-crawl speed: one feed width per cycleSeconds. Its width is
      // estimated from this segment's px-per-character, so px/s stays constant
      // across segments and matches what the two-copy crawl did.
      const headChars = charsOf(window.head.map((e) => e.entry));
      const pxPerChar = dist / Math.max(1, headChars);
      const speed = (pxPerChar * charsOf(seg.entries)) / cycleSeconds(seg.entries);
      const dur = dist / speed;
      setMotion((m) => (m && m.dist === dist && m.dur === dur ? m : { dist, dur }));
    };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (e.target === head) dist = w;
        else if (e.target === track) total = w;
        else width = w;
      }
      size();
    });
    ro.observe(head);
    ro.observe(track);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [seg.id, seg.entries, tailChars, window]);

  const onAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const feed = latest.current;
    setSeg((s) => ({ start: feedStart(s.start, window, feed), id: s.id + 1, entries: feed }));
  };
  const animationName = `bcast-crawl-${seg.id}`;

  return (
    <div
      style={{
        position: "absolute",
        left: insetLeft,
        right: 0,
        [edge]: offset,
        height,
        display: "flex",
        alignItems: "center",
        background: theme.tickerBg,
        borderBottom: edge === "top" ? "1px solid rgba(120,140,170,0.2)" : undefined,
        // A band floating below the masthead (offset top crawl) is framed on
        // both edges; one pinned to the screen edge only needs the inner line.
        borderTop:
          edge === "bottom" || offset > 0
            ? "1px solid rgba(120,140,170,0.2)"
            : undefined,
        overflow: "hidden",
        color: theme.tickerText,
        fontFamily: UI_SANS,
        pointerEvents: "none",
      }}
    >
      <style>{`@keyframes ${animationName}{from{transform:translateX(0)}to{transform:translateX(${-(motion?.dist ?? 0)}px)}}`}</style>
      {/* Title chip (optional) */}
      {title ? (
        <div
          style={{
            flex: "0 0 auto",
            zIndex: 2,
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: compact ? "0 8px" : "0 12px",
            fontSize: compact ? 9.9 : 12.1,
            fontWeight: 800,
            letterSpacing: 1.4,
            color: "#fff",
            background: theme.accent,
            clipPath: "polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%)",
            paddingRight: compact ? 16 : 20,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
      ) : null}
      {/* Crawl */}
      <div
        ref={viewportRef}
        style={{
          position: "relative",
          flex: 1,
          overflow: "hidden",
          height: "100%",
          marginLeft: contentInset,
        }}
      >
        <div
          key={seg.id}
          ref={trackRef}
          onAnimationEnd={onAnimationEnd}
          style={{
            position: "absolute",
            top: 0,
            display: "inline-flex",
            alignItems: "center",
            height: "100%",
            whiteSpace: "nowrap",
            animation: motion ? `${animationName} ${motion.dur}s linear forwards` : undefined,
            // Its own compositor layer: OBS's CEF ticks CSS animations on the
            // main thread, and without a layer each step repaints + relayerizes
            // the page (docs/watch-perf-plan.md, round 10).
            willChange: "transform",
            fontSize,
            fontWeight: 600,
            letterSpacing: 0.6,
          }}
        >
          <span ref={headRef}>
            <CrawlContent part={window.head} theme={theme} />
          </span>
          <CrawlContent part={window.tail} theme={theme} />
        </div>
      </div>
    </div>
  );
}

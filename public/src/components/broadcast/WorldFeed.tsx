"use client";

/**
 * The scrolling event feed shared by the ACTIVE FEED panel (all kinds) and the
 * per-category WORLD REPORT deck slides (ALERTS / SEISMIC / VOLCANOES, each fed
 * a single-kind slice). Just the row + marquee body — the surrounding card
 * chrome/header belongs to whoever renders it. Rows are the G.O.D.S. boxed
 * style: a dark inset tile with a severity-coloured left edge and a mono badge.
 * Once the list outgrows the window it marquees vertically — see MarqueeFeed:
 * every row still scrolls through, but only the on-screen ones exist in the DOM.
 */
import { useEffect, useRef, useState } from "react";
import type { WorldWatchItem } from "../../lib/broadcast";
import { MONO, GODS_TILE, GODS_TILE_BORDER, INK_FAINT } from "./GodsPanel";
import { useBroadcastTheme } from "./theme-context";
import { HazardGlyph } from "./glyphs";
import { feedRowMs } from "@photonsurge/shared/reading-pace";
import { useReadPace } from "./pace-context";

/** Rows shown before the list starts marqueeing (taller feeds auto-scroll). */
export const FEED_VISIBLE = 7;
export const FEED_ROW_H = 46;
/** Vertical breathing room between boxed rows, inside the fixed row height. */
const ROW_GAP = 7;

function FeedRow({ item }: { item: WorldWatchItem }) {
  const theme = useBroadcastTheme();
  // Alerts drop the severity *text* badge ("EXTREME"/"SEVERE") — sorted
  // most-severe-first, the visible window becomes a monotonous wall of
  // identical red badges; their severity-coloured left edge keeps the rank
  // readable while freeing width for the headline. Quakes ("M6.3") and
  // volcanoes ("ERUPTING") keep their badges — those carry real information.
  const badge = item.kind !== "alert";
  const textMax = badge ? 210 : 262;
  return (
    <div style={{ height: FEED_ROW_H, boxSizing: "border-box", paddingBottom: ROW_GAP }}>
      <div
        style={{
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: GODS_TILE,
          border: `1px solid ${GODS_TILE_BORDER}`,
          borderLeft: `3px solid ${item.color}`,
          padding: "0 10px",
        }}
      >
        {badge ? (
          <span
            style={{
              flex: "0 0 auto",
              minWidth: 46,
              fontFamily: MONO,
              fontSize: 13,
              letterSpacing: 0.4,
              color: item.color,
            }}
          >
            {item.tag}
          </span>
        ) : null}
        {item.photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.photo}
            alt=""
            style={{ flex: "0 0 auto", width: 30, height: 30, objectFit: "cover" }}
          />
        ) : (
          <span
            style={{ flex: "0 0 auto", width: 26, display: "flex", justifyContent: "center" }}
            title={item.kind === "quake" ? "Seismic" : undefined}
          >
            <HazardGlyph id={item.glyph} color={item.color} size={22} />
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span
            style={{
              fontSize: 14.5,
              fontWeight: 500,
              color: theme.textColor,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: textMax,
            }}
          >
            {item.flag ? `${item.flag} ` : ""}
            {item.title}
          </span>
          {item.sub ? (
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 500,
                color: item.kind === "quake" && item.sub.startsWith("TSUNAMI") ? "#f97316" : theme.dimColor,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: textMax,
                letterSpacing: 0.3,
              }}
            >
              {item.sub}
            </span>
          ) : null}
        </div>
        {item.expiresIn ? (
          <span
            style={{
              flex: "0 0 auto",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: 0.3,
              color: item.expiresIn === "expired" ? "#5a7784" : INK_FAINT,
            }}
          >
            {item.expiresIn}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Rows the marquee keeps mounted beyond the window (one entering, one leaving). */
const WINDOW_SLACK = 2;
/** Characters in one feed row, for pacing: its title, its sub-line and the
 *  expiry chip, which is what a viewer actually reads as the row passes. */
const rowChars = (item: WorldWatchItem): number =>
  item.title.length + (item.sub?.length ?? 0) + (item.expiresIn?.length ?? 0);

/** Mean row length over the feed — a feed of terse quake lines steps on faster
 *  than one of long alert headlines. */
function meanRowChars(items: readonly WorldWatchItem[]): number {
  if (!items.length) return 0;
  let n = 0;
  for (const item of items) n += rowChars(item);
  return n / items.length;
}

/**
 * Vertical marquee that keeps only the on-screen rows in the DOM. Nothing is
 * capped — the whole list scrolls through — but the previous version mounted
 * the ENTIRE list twice (for a seamless CSS loop): a 500-row ALERTS slice was
 * ~13 k DOM nodes and hundreds of thumbnail <img>s, a compositor layer the
 * height of the whole list, and Chrome's per-frame layer assignment
 * (Layerize) ballooning to ~40 ms a frame for as long as that slide was up —
 * then thousands of nodes unmounted on every deck rotation.
 *
 * Now: `visible + WINDOW_SLACK` rows. The sub-row motion is a compositor-only
 * transform written straight to the track element each frame (no React); the
 * window itself shifts by one row every `msPerRow`, which IS a React render but
 * only of a dozen rows. Row keys carry a lap counter so a row keeps its DOM
 * identity while it slides through the window instead of being re-mounted.
 *
 * `msPerRow` is the time one row takes to READ at the channel's reading pace
 * (shared/reading-pace) rather than a fixed 2.4 s, so a feed of long headlines
 * steps more slowly than one of short ones.
 */
function MarqueeFeed({ items, visible, viewH }: { items: WorldWatchItem[]; visible: number; viewH: number }) {
  const n = items.length;
  const pace = useReadPace();
  // Rounded to a tenth of a character so a feed poll that shifts the mean by a
  // hair doesn't restart the scroll clock.
  const avgChars = Math.round(meanRowChars(items) * 10) / 10;
  const msPerRow = feedRowMs(avgChars, pace);
  const [start, setStart] = useState(0);
  const startRef = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
  // Scroll clock origin, kept across item changes so a feed refresh never snaps.
  const originRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") return;
    const pxPerMs = FEED_ROW_H / msPerRow;
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (originRef.current === null) originRef.current = t;
      // Unbounded offset: the window index only ever grows, so keys never
      // collide and a row keeps its identity as it slides through.
      const offset = (t - originRef.current) * pxPerMs;
      const idx = Math.floor(offset / FEED_ROW_H);
      const frac = offset - idx * FEED_ROW_H;
      const track = trackRef.current;
      if (track) track.style.transform = `translate3d(0, ${(-frac).toFixed(2)}px, 0)`;
      if (idx !== startRef.current) {
        startRef.current = idx;
        setStart(idx);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // A pace change (operator, or a feed whose rows got longer) restarts the
    // clock; `originRef` survives, so the rows carry on from where they are.
  }, [msPerRow]);

  const count = Math.min(n, visible + WINDOW_SLACK);
  const rows: { item: WorldWatchItem; key: string }[] = [];
  for (let i = 0; i < count; i++) {
    const g = start + i;
    const item = items[g % n];
    rows.push({ item, key: `${item.key}@${Math.floor(g / n)}` });
  }
  return (
    <div style={{ height: viewH, overflow: "hidden", position: "relative" }}>
      <div ref={trackRef} style={{ willChange: "transform" }}>
        {rows.map((r) => (
          <FeedRow key={r.key} item={r.item} />
        ))}
      </div>
    </div>
  );
}

export default function WorldFeed({
  items,
  visible = FEED_VISIBLE,
  emptyLabel = "MONITORING · ALL QUIET",
}: {
  items: WorldWatchItem[];
  /** Rows shown before marqueeing kicks in. */
  visible?: number;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return (
      <div
        style={{
          fontFamily: MONO,
          fontSize: 12.5,
          color: INK_FAINT,
          textAlign: "right",
          letterSpacing: 1.2,
          paddingTop: 2,
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  // Once the feed outgrows the window, marquee it vertically (windowed — see
  // MarqueeFeed); a short feed just sits still.
  const scrolling = items.length > visible;
  const viewH = Math.min(items.length, visible) * FEED_ROW_H - (scrolling ? 0 : ROW_GAP);
  if (scrolling) return <MarqueeFeed items={items} visible={visible} viewH={viewH} />;

  return (
    <div style={{ height: viewH, overflow: "hidden", position: "relative" }}>
      {items.map((item) => (
        <FeedRow key={item.key} item={item} />
      ))}
    </div>
  );
}

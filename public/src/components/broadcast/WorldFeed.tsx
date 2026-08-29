"use client";

/**
 * The scrolling event feed shared by the ACTIVE FEED panel (all kinds) and the
 * per-category WORLD REPORT deck slides (ALERTS / SEISMIC / VOLCANOES, each fed
 * a single-kind slice). Just the row + marquee body — the surrounding card
 * chrome/header belongs to whoever renders it. Rows are the G.O.D.S. boxed
 * style: a dark inset tile with a severity-coloured left edge and a mono badge.
 * Once the list outgrows the window it marquees vertically: we render the list
 * twice and slide up by exactly one copy, so the loop is seamless.
 */
import type { WorldWatchItem } from "../../lib/broadcast";
import { MONO, GODS_TILE, GODS_TILE_BORDER, INK_FAINT } from "./GodsPanel";
import { useBroadcastTheme } from "./theme-context";

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
            style={{ flex: "0 0 auto", width: 26, textAlign: "center", fontSize: 17.6, lineHeight: 1 }}
            title={item.kind === "quake" ? "Seismic" : undefined}
          >
            {item.icon}
          </span>
        )}
        <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span
            style={{
              fontSize: 14.5,
              fontWeight: 500,
              color: "#dfe9ee",
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

  // Once the feed outgrows the window, marquee it vertically. Duration scales
  // with length (a busy planet scrolls faster but stays readable).
  const scrolling = items.length > visible;
  const viewH = Math.min(items.length, visible) * FEED_ROW_H - (scrolling ? 0 : ROW_GAP);
  const duration = Math.max(12, items.length * 2.4);

  return (
    <div style={{ height: viewH, overflow: "hidden", position: "relative" }}>
      <style>{"@keyframes bcast-wwscroll{from{transform:translateY(0)}to{transform:translateY(-50%)}}"}</style>
      <div
        style={
          scrolling
            ? { animation: `bcast-wwscroll ${duration}s linear infinite`, willChange: "transform" }
            : undefined
        }
      >
        {items.map((item) => (
          <FeedRow key={item.key} item={item} />
        ))}
        {/* Second copy: only needed while marqueeing, for the seamless wrap. */}
        {scrolling ? items.map((item) => <FeedRow key={`dup:${item.key}`} item={item} />) : null}
      </div>
    </div>
  );
}

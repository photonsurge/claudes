"use client";

/**
 * The scrolling event feed shared by the ACTIVE FEED panel (all kinds) and the
 * per-category WORLD REPORT deck slides (ALERTS / SEISMIC / VOLCANOES, each fed
 * a single-kind slice). Just the row + marquee body — the surrounding card
 * chrome/header belongs to whoever renders it. Once the list outgrows the
 * window it marquees vertically: we render the list twice and slide up by
 * exactly one copy, so the loop is seamless.
 */
import type { WorldWatchItem } from "../../lib/broadcast";
import { useBroadcastTheme } from "./theme-context";

/** Rows shown before the list starts marqueeing (taller feeds auto-scroll). */
export const FEED_VISIBLE = 7;
export const FEED_ROW_H = 42;

function FeedRow({ item }: { item: WorldWatchItem }) {
  const theme = useBroadcastTheme();
  // Alerts drop the severity *text* chip ("EXTREME"/"SEVERE") — sorted
  // most-severe-first, the visible window becomes a monotonous wall of
  // identical red chips. A slim severity-coloured bar keeps the rank readable
  // while freeing width for the headline. Quakes ("M6.3") and volcanoes
  // ("ERUPTING") keep their chips — those carry real information per row.
  const chip = item.kind !== "alert";
  const textMax = chip ? 210 : 262;
  return (
    <div
      style={{
        height: FEED_ROW_H,
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderTop: "1px solid rgba(255,255,255,0.05)",
        background: `${item.color}14`,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 4,
          height: FEED_ROW_H - 12,
          borderRadius: 2,
          background: item.color,
          boxShadow: `0 0 6px ${item.color}66`,
        }}
      />
      {item.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.photo}
          alt=""
          style={{ flex: "0 0 auto", width: 30, height: 30, borderRadius: 6, objectFit: "cover" }}
        />
      ) : (
        <span
          style={{ flex: "0 0 auto", width: 30, textAlign: "center", fontSize: 18.7, lineHeight: 1 }}
          title={item.kind === "quake" ? "Seismic" : undefined}
        >
          {item.icon}
        </span>
      )}
      {chip ? (
        <span
          style={{
            flex: "0 0 auto",
            minWidth: 46,
            textAlign: "center",
            fontSize: 13.2,
            fontWeight: 800,
            letterSpacing: 0.4,
            color: item.color,
            padding: "3px 7px",
            borderRadius: 5,
            background: `${item.color}26`,
            border: `1px solid ${item.color}66`,
          }}
        >
          {item.tag}
        </span>
      ) : null}
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span
          style={{
            fontSize: 15.4,
            fontWeight: 700,
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
              fontSize: 12.1,
              fontWeight: 600,
              color: item.kind === "quake" && item.sub.startsWith("TSUNAMI") ? "#f97316" : "#8fa0b8",
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
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.3,
            color: item.expiresIn === "expired" ? "#6b7688" : "#7f8ea6",
          }}
        >
          {item.expiresIn}
        </span>
      ) : null}
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
          fontSize: 14.3,
          fontWeight: 700,
          color: "#7f8ea6",
          textAlign: "right",
          letterSpacing: 0.5,
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
  const viewH = Math.min(items.length, visible) * FEED_ROW_H;
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

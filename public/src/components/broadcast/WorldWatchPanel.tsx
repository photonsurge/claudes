"use client";

/**
 * Top-right "WORLD WATCH": an always-on, whole-planet situation feed — a compact
 * severity/quake tally in the header, then a live list that constantly scrolls
 * through every active warning and every recent earthquake, most-serious first.
 * Unlike the single-event LiveAlertPanel it never hides and doesn't follow the
 * operator's show-alerts/seismic toggles: it pulls its own global feed (see
 * useWorldWatch) so the broadcast always carries a rolling state-of-the-world
 * readout. Pointer-inert like the rest of the chrome.
 */
import { useWorldWatch } from "../../lib/world-watch";
import type { WorldWatchItem } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

/** Rows shown before the list starts marqueeing (taller feeds auto-scroll). */
const VISIBLE = 6;
const ROW_H = 34;

function FeedRow({ item }: { item: WorldWatchItem }) {
  return (
    <div
      style={{
        height: ROW_H,
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderTop: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          minWidth: 40,
          textAlign: "center",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 0.4,
          color: item.color,
          padding: "2px 6px",
          borderRadius: 5,
          background: `${item.color}1f`,
          border: `1px solid ${item.color}55`,
        }}
      >
        {item.tag}
      </span>
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#e6edf7",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 190,
          }}
        >
          {item.title}
        </span>
        {item.sub ? (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: item.kind === "quake" && item.sub.startsWith("TSUNAMI") ? "#f97316" : "#8fa0b8",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 190,
              letterSpacing: 0.3,
            }}
          >
            {item.sub}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function WorldWatchPanel({ theme = DEFAULT_THEME }: { theme?: BroadcastTheme }) {
  const s = useWorldWatch();
  const feed = s.feed;
  const topColor = s.bySeverity[0]?.color ?? theme.accent;
  const quiet = feed.length === 0;

  // Once the feed outgrows the window, marquee it vertically: we render the list
  // twice and slide up by exactly one copy, so the loop is seamless. Duration
  // scales with length (a busy planet scrolls faster but stays readable).
  const scrolling = feed.length > VISIBLE;
  const viewH = Math.min(feed.length, VISIBLE) * ROW_H;
  const duration = Math.max(12, feed.length * 2.4);

  return (
    <div
      style={{
        position: "relative",
        width: 258,
        padding: "10px 14px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderLeft: `3px solid ${topColor}`,
        borderRadius: 12,
        boxShadow: `0 8px 26px rgba(0,0,0,0.45), 0 0 14px ${topColor}22`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 7,
      }}
    >
      <style>{"@keyframes bcast-wwscroll{from{transform:translateY(0)}to{transform:translateY(-50%)}}"}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: "#dfe7f5",
        }}
      >
        <span>WORLD WATCH</span>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>
          LAST 24H
        </span>
      </div>

      {/* Compact tally line — how many warnings, how many quakes, at a glance. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: "#9fb0c8",
        }}
      >
        <span style={{ color: topColor }}>⚠ {s.alertTotal} ALERTS</span>
        <span>🌐 {s.quakeCount} QUAKES</span>
      </div>

      {quiet ? (
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "#7f8ea6",
            textAlign: "right",
            letterSpacing: 0.5,
            paddingTop: 2,
          }}
        >
          MONITORING · ALL QUIET
        </div>
      ) : (
        <div style={{ height: viewH, overflow: "hidden", position: "relative" }}>
          <div
            style={
              scrolling
                ? {
                    animation: `bcast-wwscroll ${duration}s linear infinite`,
                    willChange: "transform",
                  }
                : undefined
            }
          >
            {feed.map((item) => (
              <FeedRow key={item.key} item={item} />
            ))}
            {/* Second copy: only needed while marqueeing, for the seamless wrap. */}
            {scrolling
              ? feed.map((item) => <FeedRow key={`dup:${item.key}`} item={item} />)
              : null}
          </div>
        </div>
      )}
    </div>
  );
}

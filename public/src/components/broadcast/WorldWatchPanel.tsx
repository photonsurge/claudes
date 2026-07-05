"use client";

/**
 * Top-right "ACTIVE FEED": a live list that constantly scrolls through every
 * broadcast-worthy active warning and recent earthquake, most-serious first.
 * A separate, smaller card that sits below WorldSituationPanel (the hero
 * tally) — split apart so the "how much" headline and the "which ones" detail
 * each read as their own block instead of one crowded panel. Unlike the
 * single-event LiveAlertPanel it never hides and doesn't follow the
 * operator's show-alerts/seismic toggles: it pulls its own global feed (see
 * useWorldWatch) so the broadcast always carries a rolling state-of-the-world
 * readout. Pointer-inert like the rest of the chrome.
 */
import { useWorldWatch } from "../../lib/world-watch";
import type { WorldWatchItem } from "../../lib/broadcast";
import type { City } from "../../lib/cities";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

/** Rows shown before the list starts marqueeing (taller feeds auto-scroll). */
const VISIBLE = 7;
const ROW_H = 42;

function FeedRow({ item }: { item: WorldWatchItem }) {
  return (
    <div
      style={{
        height: ROW_H,
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderTop: "1px solid rgba(255,255,255,0.05)",
        background: `${item.color}14`,
      }}
    >
      <span style={{ flex: "0 0 auto", fontSize: 17, lineHeight: 1 }} title={item.kind === "quake" ? "Seismic" : undefined}>
        {item.icon}
      </span>
      <span
        style={{
          flex: "0 0 auto",
          minWidth: 46,
          textAlign: "center",
          fontSize: 12,
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
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e6edf7",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 210,
          }}
        >
          {item.flag ? `${item.flag} ` : ""}
          {item.title}
        </span>
        {item.sub ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: item.kind === "quake" && item.sub.startsWith("TSUNAMI") ? "#f97316" : "#8fa0b8",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 210,
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
            fontSize: 10,
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

export default function WorldWatchPanel({
  theme = DEFAULT_THEME,
  cities = [],
}: {
  theme?: BroadcastTheme;
  /** Curated, wiki-enriched cities (BroadcastFrame already loads these) — used only to flag rows. */
  cities?: City[];
}) {
  const s = useWorldWatch(cities);
  const feed = s.feed;
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
        width: 400,
        padding: "14px 20px 18px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderRadius: 14,
        boxShadow: "0 10px 32px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <style>{"@keyframes bcast-wwscroll{from{transform:translateY(0)}to{transform:translateY(-50%)}}"}</style>

      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.6,
          color: theme.accent,
          borderBottom: `2px solid ${theme.accent}55`,
          paddingBottom: 4,
        }}
      >
        ACTIVE FEED
      </div>

      {quiet ? (
        <div
          style={{
            fontSize: 13,
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

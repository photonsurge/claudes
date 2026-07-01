"use client";

/**
 * A broadcast crawl: a title chip pinned to the left and the live feed scrolling
 * seamlessly beside it. The content is rendered twice and the track slides by
 * exactly half its width, so the loop is gapless; speed is derived from content
 * length so a short feed doesn't whip past. Pure CSS animation — no rAF.
 */
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

export default function Ticker({
  title,
  items,
  edge,
  height = 30,
  compact = false,
  theme = DEFAULT_THEME,
}: {
  title: string;
  items: string[];
  /** Which edge to pin to. */
  edge: "top" | "bottom";
  height?: number;
  compact?: boolean;
  theme?: BroadcastTheme;
}) {
  const line = items.length
    ? items.join("     ❯     ")
    : "STANDING BY · AWAITING LIVE FEED";
  // Seconds for one full cycle — ~7 chars/sec, floored so short feeds still move.
  const dur = Math.max(24, line.length * 0.16);
  const fontSize = compact ? 10 : 12;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        [edge]: 0,
        height,
        display: "flex",
        alignItems: "center",
        background: "linear-gradient(180deg, rgba(6,10,18,0.94), rgba(4,7,13,0.9))",
        borderBottom: edge === "top" ? "1px solid rgba(120,140,170,0.2)" : undefined,
        borderTop: edge === "bottom" ? "1px solid rgba(120,140,170,0.2)" : undefined,
        overflow: "hidden",
        color: "#dfe7f5",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      <style>{"@keyframes bcast-crawl{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      {/* Title chip */}
      <div
        style={{
          flex: "0 0 auto",
          zIndex: 2,
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: compact ? "0 8px" : "0 12px",
          fontSize: compact ? 9 : 11,
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
      {/* Crawl */}
      <div style={{ position: "relative", flex: 1, overflow: "hidden", height: "100%" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            display: "inline-flex",
            alignItems: "center",
            height: "100%",
            whiteSpace: "nowrap",
            animation: `bcast-crawl ${dur}s linear infinite`,
            fontSize,
            fontWeight: 600,
            letterSpacing: 0.6,
          }}
        >
          <span style={{ paddingLeft: 24 }}>{line}</span>
          <span style={{ paddingLeft: 24 }}>{line}</span>
        </div>
      </div>
    </div>
  );
}

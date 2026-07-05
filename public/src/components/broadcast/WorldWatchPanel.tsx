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
const VISIBLE = 7;
const ROW_H = 42;

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.08)", flex: "0 0 auto" }} />;
}

/** Hero count + caption — the "how many, total" half of the state-of-the-globe summary. */
function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 28,
          fontWeight: 800,
          color: "#fff",
          lineHeight: 1,
          textShadow: "0 1px 6px rgba(0,0,0,0.5)",
        }}
      >
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color, marginTop: 4 }}>{label}</div>
    </div>
  );
}

/** One "2 EXTREME" pill in the severity breakdown — the "how bad" detail behind
 *  the flat ALERTS total above it. */
function SeverityPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span
      style={{
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.5,
        color: "#fff",
        background: color,
        boxShadow: `0 0 8px ${color}66`,
        whiteSpace: "nowrap",
      }}
    >
      {count} {label.toUpperCase()}
    </span>
  );
}

/** One "Asia ▓▓▓▓▓ 91" row in the continent breakdown — a multi-tone bar (one
 *  segment per severity level present, same red/orange ramp as the panel-wide
 *  EXTREME/SEVERE pills, plus a quake segment in the accent colour) so the
 *  composition reads at a glance instead of a flat "how many" blob. Bar length
 *  relative to the busiest continent. */
function ContinentRow({
  continent,
  bySeverity,
  quakeCount,
  maxTotal,
  quakeColor,
}: {
  continent: string;
  bySeverity: { rank: number; color: string; count: number }[];
  quakeCount: number;
  maxTotal: number;
  quakeColor: string;
}) {
  const alertCount = bySeverity.reduce((sum, b) => sum + b.count, 0);
  const total = alertCount + quakeCount;
  const pct = maxTotal > 0 ? Math.max(6, Math.round((total / maxTotal) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          flex: "0 0 66px",
          fontSize: 10,
          fontWeight: 700,
          color: "#c3cee0",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {continent}
      </span>
      <div
        style={{
          flex: 1,
          height: 7,
          borderRadius: 3,
          background: "rgba(255,255,255,0.07)",
          overflow: "hidden",
        }}
      >
        <div style={{ width: `${pct}%`, height: "100%", display: "flex" }}>
          {bySeverity.map((b) => (
            <div
              key={b.rank}
              style={{
                width: `${(b.count / total) * 100}%`,
                height: "100%",
                background: b.color,
                boxShadow: `0 0 6px ${b.color}66`,
              }}
            />
          ))}
          {quakeCount > 0 ? (
            <div
              style={{
                width: `${(quakeCount / total) * 100}%`,
                height: "100%",
                background: quakeColor,
                boxShadow: `0 0 6px ${quakeColor}66`,
              }}
            />
          ) : null}
        </div>
      </div>
      <span
        style={{
          flex: "0 0 18px",
          textAlign: "right",
          fontSize: 10,
          fontWeight: 700,
          color: "#9fb0c8",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {total}
      </span>
    </div>
  );
}

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
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#e6edf7",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: 230,
          }}
        >
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
              maxWidth: 230,
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
        width: 340,
        padding: "16px 20px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderLeft: `4px solid ${topColor}`,
        borderRadius: 14,
        boxShadow: `0 10px 32px rgba(0,0,0,0.5), 0 0 18px ${topColor}28`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <style>{"@keyframes bcast-wwscroll{from{transform:translateY(0)}to{transform:translateY(-50%)}}"}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: 1.6,
          color: "#dfe7f5",
        }}
      >
        <span>WORLD WATCH</span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>
          LAST 24H
        </span>
      </div>

      {/* State-of-the-globe summary: hero totals, the severity-level breakdown
          behind the flat ALERTS count, then the per-continent breakdown. */}
      <div style={{ display: "flex", gap: 18 }}>
        <StatTile label="ALERTS" value={s.alertTotal} color={topColor} />
        <StatTile label="QUAKES" value={s.quakeCount} color={theme.accent} />
      </div>

      {s.bySeverity.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {s.bySeverity.map((b) => (
            <SeverityPill key={b.rank} label={b.label} count={b.count} color={b.color} />
          ))}
        </div>
      ) : null}

      {s.byContinent.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {s.byContinent.map((c) => (
            <ContinentRow
              key={c.continent}
              continent={c.continent}
              bySeverity={c.bySeverity}
              quakeCount={c.quakeCount}
              maxTotal={s.byContinent[0].total}
              quakeColor={theme.accent}
            />
          ))}
        </div>
      ) : null}

      <Divider />

      {/* The scrolling feed lives below its own eyebrow, visually split from the
          summary above so "the tally" and "the crawl" read as separate blocks. */}
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

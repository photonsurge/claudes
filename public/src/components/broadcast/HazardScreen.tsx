"use client";

/**
 * A single-category drill-down slide in the WORLD REPORT deck — ALERTS,
 * SEISMIC, or VOLCANOES. The DETECTION GRID slide (WorldSituationPanel) tallies
 * all three side by side; each of these takes one category and gives it the
 * whole card: a hero count, that category's severity/magnitude/status
 * breakdown, a per-continent bar column on the category's own scale, and the
 * scrolling feed filtered to just this kind. Everything is derived from the
 * same shared `worldWatch` tally the deck already holds — no extra fetch.
 * Pointer-inert like the rest of the chrome.
 */
import type { WorldWatchItem } from "../../lib/broadcast";
import { accentBorderRight, GLASS_BG, type BroadcastTheme } from "./config";
import { StatTile, BreakdownChip, MiniBar } from "./worldStat";
import FeedSection from "./FeedSection";

export interface HazardContinent {
  name: string;
  count: number;
  segments: { key: string; color: string; count: number }[];
}

export default function HazardScreen({
  title,
  heroLabel,
  heroCount,
  heroColor,
  subtitle,
  chips,
  continents,
  feed,
  emptyFeedLabel,
  theme,
}: {
  title: string;
  heroLabel: string;
  heroCount: number;
  heroColor: string;
  /** Optional single headline under the hero (e.g. the strongest quake). */
  subtitle?: string;
  chips: { key: string; label: string; count: number; color: string }[];
  continents: HazardContinent[];
  feed: WorldWatchItem[];
  emptyFeedLabel?: string;
  theme: BroadcastTheme;
}) {
  const max = Math.max(1, ...continents.map((c) => c.count));

  return (
    <div
      style={{
        position: "relative",
        width: 400,
        padding: "20px 24px",
        background: GLASS_BG,
        ...accentBorderRight(theme.panelBorder, `5px solid ${heroColor}`),
        borderRadius: 16,
        boxShadow: `0 12px 36px rgba(0,0,0,0.5), 0 0 20px ${heroColor}28`,
        backdropFilter: "blur(11px)",
        WebkitBackdropFilter: "blur(11px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 14.3,
          fontWeight: 800,
          letterSpacing: 1.8,
          color: "#dfe7f5",
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>LAST 24H</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
        <StatTile label={heroLabel} value={heroCount} color={heroColor} />
        {subtitle ? (
          <div
            style={{
              flex: 2,
              minWidth: 0,
              fontSize: 13.2,
              fontWeight: 700,
              color: "#c3cee0",
              lineHeight: 1.3,
              textAlign: "right",
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
          {chips.map((c) => (
            <BreakdownChip key={c.key} label={c.label} count={c.count} color={c.color} />
          ))}
        </div>
      ) : null}

      {continents.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {continents.map((c) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  flex: "0 0 66px",
                  fontSize: 12.1,
                  fontWeight: 700,
                  color: "#c3cee0",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {c.name}
              </span>
              <MiniBar count={c.count} max={max} segments={c.segments} />
              <span
                style={{
                  flex: "0 0 24px",
                  textAlign: "right",
                  fontSize: 12.1,
                  fontWeight: 700,
                  color: "#9fb0c8",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {c.count}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <FeedSection feed={feed} theme={theme} emptyLabel={emptyFeedLabel} />
    </div>
  );
}

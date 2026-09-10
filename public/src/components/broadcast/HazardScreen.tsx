"use client";

/**
 * A single-category drill-down slide in the WORLD REPORT deck — ALERTS,
 * SEISMIC, or VOLCANOES. The DETECTION GRID slide (WorldSituationPanel) tallies
 * all three side by side; each of these takes one category and gives it the
 * whole card: a big headline count (GodsHeadline), that category's severity/
 * magnitude/status breakdown, a per-continent bar column on the category's own
 * scale, and the scrolling feed filtered to just this kind. Everything is
 * derived from the same shared `worldWatch` tally the deck already holds — no
 * extra fetch. Rendered on the shared G.O.D.S. chamfered panel chrome.
 * Pointer-inert like the rest of the chrome.
 */
import type { WorldWatchItem } from "../../lib/broadcast";
import type { BroadcastTheme } from "./config";
import { GodsPanel, GodsPanelHeader, GodsHeadline, MONO, INK_DIM } from "./GodsPanel";
import { BreakdownChip, MiniBar } from "./worldStat";
import FeedSection from "./FeedSection";

/** Feed rows on a category slide — see the note at the FeedSection below. */
export const FEED_ROWS = 4;

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
    <GodsPanel
      width={400}
      notch={[14, 22]}
      padding="16px 22px 18px"
      gap={10}
      style={{ pointerEvents: "none" }}
    >
      <GodsPanelHeader title={title} tag="LAST 24H" accent={theme.accent} />

      <GodsHeadline
        value={heroCount.toLocaleString()}
        caption={heroLabel}
        captionColor={heroColor}
        note={subtitle}
      />

      {chips.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
          {chips.map((c) => (
            <BreakdownChip key={c.key} label={c.label} count={c.count} color={c.color} />
          ))}
        </div>
      ) : null}

      {continents.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {continents.map((c) => (
            <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  flex: "0 0 112px",
                  fontFamily: MONO,
                  fontSize: 11.5,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: INK_DIM,
                  whiteSpace: "nowrap",
                }}
              >
                {c.name}
              </span>
              <MiniBar count={c.count} max={max} segments={c.segments} />
              <span
                style={{
                  flex: "0 0 24px",
                  textAlign: "right",
                  fontFamily: MONO,
                  fontSize: 12,
                  color: "#dfe9ee",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {c.count}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* Four rows, like the DETECTION GRID slide: with the live alert stacked
          above, five pushed this card past the ticker and the column had to
          scroll it as a whole — the feed marquees the rest through anyway. */}
      <FeedSection feed={feed} theme={theme} visible={FEED_ROWS} emptyLabel={emptyFeedLabel} />
    </GodsPanel>
  );
}

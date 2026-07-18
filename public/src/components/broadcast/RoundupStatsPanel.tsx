"use client";

/**
 * Round-up card — the narrative text plus the headline numbers and source
 * provenance behind a round-up (see SegmentSummary.narrative/stats/sources,
 * shared/src/director.ts), mirroring the stat tally already shown on
 * /admin/summaries. This is the round-up narrative's on-air home now that it no
 * longer takes over the bottom ticker: it rotates in the left-column deck while
 * a round-up world spin tours its hotspots (see mode-slides `segment.summary`).
 */
import type { iSummaryStats } from "@photonsurge/shared/db/event-summary-model";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { DIVIDER } from "./BroadcastCard";

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  if (!value) return null;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 24.2, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "#9fb3cc", marginTop: 3 }}>
        {label}
        {sub ? <span style={{ color: "#6b7a94" }}> · {sub}</span> : null}
      </div>
    </div>
  );
}

export default function RoundupStatsPanel({
  narrative,
  stats,
  sources,
  theme = DEFAULT_THEME,
}: {
  narrative?: string;
  stats?: iSummaryStats;
  sources?: string[];
  theme?: BroadcastTheme;
}) {
  const tiles = stats
    ? [
        { label: "ACTIVE ALERTS", value: stats.alertsActive },
        { label: "CYCLONES", value: stats.cyclones },
        { label: "QUAKES", value: stats.quakeCount, sub: stats.quakeMaxMag ? `M${stats.quakeMaxMag.toFixed(1)} max` : undefined },
        { label: "VOLCANOES", value: stats.volcanoCount, sub: stats.volcanoErupting ? `${stats.volcanoErupting} erupting` : undefined },
        { label: "NOTABLE TRACKS", value: stats.tracksNotable },
      ].filter((t) => t.value > 0)
    : [];
  const narrativeText = narrative?.trim();
  if (!narrativeText && !tiles.length && !sources?.length) return null;

  return (
    <BroadcastCard theme={theme}>
      {narrativeText ? (
        <div
          style={{
            fontSize: 16.5,
            lineHeight: 1.5,
            color: "#e8eef7",
            marginBottom: tiles.length || sources?.length ? 12 : 0,
            paddingBottom: tiles.length || sources?.length ? 10 : 0,
            borderBottom: tiles.length || sources?.length ? DIVIDER : undefined,
          }}
        >
          {narrativeText}
        </div>
      ) : null}
      {tiles.length ? (
        <div style={{ display: "flex", gap: 18 }}>
          {tiles.map((t) => (
            <Stat key={t.label} label={t.label} value={t.value} sub={t.sub} />
          ))}
        </div>
      ) : null}
      {sources?.length ? (
        <div
          style={{
            marginTop: tiles.length ? 10 : 0,
            paddingTop: tiles.length ? 8 : 0,
            borderTop: tiles.length ? DIVIDER : undefined,
            fontSize: 12.1,
            color: "#8b98ae",
            letterSpacing: 0.3,
          }}
        >
          Sources: {sources.join(", ")}
        </div>
      ) : null}
    </BroadcastCard>
  );
}

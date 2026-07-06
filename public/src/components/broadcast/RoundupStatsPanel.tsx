"use client";

/**
 * Round-up "more info" card — the headline numbers and source provenance
 * behind a `summary` segment's narrative (see SegmentSummary.stats/sources,
 * shared/src/director.ts), mirroring the stat tally already shown on
 * /admin/summaries. Sits in the bottom-left column above OnAirCard while a
 * round-up is on air — that slot is otherwise empty for `summary` (no real
 * ground location, see hasRealLocation in ./kinds).
 */
import type { iSummaryStats } from "@photonsurge/shared/db/event-summary-model";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  if (!value) return null;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: "#9fb3cc", marginTop: 3 }}>
        {label}
        {sub ? <span style={{ color: "#6b7a94" }}> · {sub}</span> : null}
      </div>
    </div>
  );
}

export default function RoundupStatsPanel({
  stats,
  sources,
  theme = DEFAULT_THEME,
}: {
  stats?: iSummaryStats;
  sources?: string[];
  theme?: BroadcastTheme;
}) {
  if (!stats) return null;
  const tiles = [
    { label: "ACTIVE ALERTS", value: stats.alertsActive },
    { label: "CYCLONES", value: stats.cyclones },
    { label: "QUAKES", value: stats.quakeCount, sub: stats.quakeMaxMag ? `M${stats.quakeMaxMag.toFixed(1)} max` : undefined },
    { label: "NOTABLE TRACKS", value: stats.tracksNotable },
  ].filter((t) => t.value > 0);
  if (!tiles.length && !sources?.length) return null;

  return (
    <div
      style={{
        width: 460,
        padding: "12px 20px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderLeft: `4px solid ${theme.accent}`,
        borderRadius: 14,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        color: "#e6edf7",
      }}
    >
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
            borderTop: tiles.length ? "1px solid rgba(120,140,170,0.15)" : undefined,
            fontSize: 11,
            color: "#8b98ae",
            letterSpacing: 0.3,
          }}
        >
          Sources: {sources.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

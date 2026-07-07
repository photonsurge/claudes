"use client";

/**
 * Top-right "WORLD WATCH" situation summary — the always-on, whole-planet
 * tally: hero ALERTS/QUAKES totals, the severity/magnitude breakdown behind
 * each, and a per-continent composition graph (alerts | quakes side by side,
 * each its own colour ramp and scale). A separate, bigger card from the
 * scrolling ACTIVE FEED (see WorldWatchPanel) that sits below it — the tally
 * is the "how much/how bad" headline, the feed is the "which ones" detail, and
 * they read better as two distinct blocks than one crowded card. Deliberately
 * independent of the operator's show-alerts/seismic toggles and the camera
 * bbox (see useWorldWatch). Pointer-inert like the rest of the chrome.
 *
 * Takes the shared tally as a prop rather than calling useWorldWatch itself —
 * BroadcastFrame fetches it once and hands the same result to this AND
 * WorldWatchPanel, so the (potentially 5000-row) global fetch never doubles up.
 */
import type { WorldWatchState } from "../../lib/world-watch";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

/** Hero count + caption. */
function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{
          fontSize: 36,
          fontWeight: 800,
          color: "#fff",
          lineHeight: 1,
          textShadow: "0 1px 6px rgba(0,0,0,0.5)",
        }}
      >
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color, marginTop: 5 }}>{label}</div>
    </div>
  );
}

/** One "● 34 Extreme" chip in the severity/magnitude breakdown — a coloured
 *  dot + count + label, light enough that a dozen of them still read as one
 *  scannable line instead of a wall of boxed pills. */
function BreakdownChip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: color,
          boxShadow: `0 0 5px ${color}99`,
          flex: "0 0 auto",
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, color: "#c3cee0", letterSpacing: 0.3 }}>{label}</span>
    </span>
  );
}

/** A single mini bar-graph: coloured segments proportional to their own share,
 *  overall length relative to the busiest continent IN THIS SAME CATEGORY (not
 *  the combined total) — so the alerts column and the quakes column each read
 *  on their own scale instead of one category swamping the other. Thin dark
 *  gaps between segments so adjacent colours never blur into one another. */
function MiniBar({
  count,
  segments,
  max,
}: {
  count: number;
  segments: { key: string; color: string; count: number }[];
  max: number;
}) {
  const pct = max > 0 && count > 0 ? Math.max(6, Math.round((count / max) * 100)) : 0;
  return (
    <div
      style={{
        flex: 1,
        height: 9,
        borderRadius: 3,
        background: "rgba(255,255,255,0.07)",
        overflow: "hidden",
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", display: "flex" }}>
        {count > 0 &&
          segments.map((s, i) => (
            <div
              key={s.key}
              style={{
                width: `${(s.count / count) * 100}%`,
                height: "100%",
                background: s.color,
                borderRight: i < segments.length - 1 ? "1px solid rgba(0,0,0,0.4)" : undefined,
              }}
            />
          ))}
      </div>
    </div>
  );
}

/** One "Asia [alerts bar] 129  [quakes bar] 63  [volcanoes bar] 2" row — three
 *  side-by-side mini graphs (alerts | quakes | volcanoes), each its own colour
 *  ramp and scale, so the three event types never blend into one ambiguous bar. */
function ContinentRow({
  continent,
  alertCount,
  bySeverity,
  quakeCount,
  byMagClass,
  volcanoCount,
  byVolcanoStatus,
  maxAlert,
  maxQuake,
  maxVolcano,
}: {
  continent: string;
  alertCount: number;
  bySeverity: { rank: number; color: string; count: number }[];
  quakeCount: number;
  byMagClass: { cls: string; color: string; count: number }[];
  volcanoCount: number;
  byVolcanoStatus: { status: string; color: string; count: number }[];
  maxAlert: number;
  maxQuake: number;
  maxVolcano: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          flex: "0 0 66px",
          fontSize: 11,
          fontWeight: 700,
          color: "#c3cee0",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {continent}
      </span>
      <MiniBar
        count={alertCount}
        max={maxAlert}
        segments={bySeverity.map((b) => ({ key: `sev:${b.rank}`, color: b.color, count: b.count }))}
      />
      <span
        style={{
          flex: "0 0 18px",
          textAlign: "right",
          fontSize: 11,
          fontWeight: 700,
          color: "#9fb0c8",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {alertCount}
      </span>
      <MiniBar
        count={quakeCount}
        max={maxQuake}
        segments={byMagClass.map((b) => ({ key: `mag:${b.cls}`, color: b.color, count: b.count }))}
      />
      <span
        style={{
          flex: "0 0 18px",
          textAlign: "right",
          fontSize: 11,
          fontWeight: 700,
          color: "#9fb0c8",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {quakeCount}
      </span>
      <MiniBar
        count={volcanoCount}
        max={maxVolcano}
        segments={byVolcanoStatus.map((b) => ({ key: `volc:${b.status}`, color: b.color, count: b.count }))}
      />
      <span
        style={{
          flex: "0 0 18px",
          textAlign: "right",
          fontSize: 11,
          fontWeight: 700,
          color: "#9fb0c8",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {volcanoCount}
      </span>
    </div>
  );
}

export default function WorldSituationPanel({
  worldWatch,
  theme = DEFAULT_THEME,
}: {
  worldWatch: WorldWatchState;
  theme?: BroadcastTheme;
}) {
  const s = worldWatch;
  const topColor = s.bySeverity[0]?.color ?? theme.accent;
  const volcanoColor = s.byVolcanoStatus[0]?.color ?? "#f97316";

  // Each column's own busiest continent — so the alerts bar, quakes bar, and
  // volcanoes bar each scale independently and none silently swamps another.
  const maxAlert = Math.max(1, ...s.byContinent.map((c) => c.alertCount));
  const maxQuake = Math.max(1, ...s.byContinent.map((c) => c.quakeCount));
  const maxVolcano = Math.max(1, ...s.byContinent.map((c) => c.volcanoCount));

  return (
    <div
      style={{
        position: "relative",
        width: 400,
        padding: "20px 24px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderLeft: `5px solid ${topColor}`,
        borderRadius: 16,
        boxShadow: `0 12px 36px rgba(0,0,0,0.5), 0 0 20px ${topColor}28`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
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
          fontSize: 13,
          fontWeight: 800,
          letterSpacing: 1.8,
          color: "#dfe7f5",
        }}
      >
        <span>WORLD WATCH</span>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>
          LAST 24H
        </span>
      </div>

      <div style={{ display: "flex", gap: 18 }}>
        <StatTile label="ALERTS" value={s.alertTotal} color={topColor} />
        <StatTile label="QUAKES" value={s.quakeCount} color={theme.accent} />
        <StatTile label="VOLCANOES" value={s.volcanoCount} color={volcanoColor} />
      </div>

      {s.bySeverity.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
          {s.bySeverity.map((b) => (
            <BreakdownChip key={b.rank} label={b.label} count={b.count} color={b.color} />
          ))}
        </div>
      ) : null}

      {s.byMagClass.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
          {s.byMagClass.map((b) => (
            <BreakdownChip key={b.cls} label={b.label} count={b.count} color={b.color} />
          ))}
        </div>
      ) : null}

      {s.byVolcanoStatus.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
          {s.byVolcanoStatus.map((b) => (
            <BreakdownChip key={b.status} label={b.label} count={b.count} color={b.color} />
          ))}
        </div>
      ) : null}

      {s.byContinent.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Column legend — once, not per row — so it's clear the three mini
              graphs below are ALERTS, QUAKES, then VOLCANOES, not one blended bar. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: "0 0 66px" }} />
            <span style={{ flex: 1, fontSize: 9, fontWeight: 800, letterSpacing: 1, color: topColor }}>
              ALERTS
            </span>
            <span style={{ flex: "0 0 18px" }} />
            <span
              style={{
                flex: 1,
                textAlign: "right",
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 1,
                color: theme.accent,
              }}
            >
              QUAKES
            </span>
            <span style={{ flex: "0 0 18px" }} />
            <span
              style={{
                flex: 1,
                textAlign: "right",
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 1,
                color: volcanoColor,
              }}
            >
              VOLCANOES
            </span>
            <span style={{ flex: "0 0 18px" }} />
          </div>
          {s.byContinent.map((c) => (
            <ContinentRow
              key={c.continent}
              continent={c.continent}
              alertCount={c.alertCount}
              bySeverity={c.bySeverity}
              quakeCount={c.quakeCount}
              byMagClass={c.byMagClass}
              volcanoCount={c.volcanoCount}
              byVolcanoStatus={c.byVolcanoStatus}
              maxAlert={maxAlert}
              maxQuake={maxQuake}
              maxVolcano={maxVolcano}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * DETECTION GRID situation summary — the always-on, whole-planet tally: hero
 * ALERTS/QUAKES/VOLCANIC totals, the severity/magnitude breakdown behind each,
 * and a per-continent composition graph (alerts | quakes | volcanoes side by
 * side, each its own colour ramp and scale). The scrolling ACTIVE FEED rides
 * integrated at the card's foot (see FeedSection) — the tally is the "how
 * much/how bad" headline, the feed the "which ones" detail. Deliberately
 * independent of the operator's show-alerts/seismic toggles and the camera
 * bbox (see useWorldWatch). Pointer-inert like the rest of the chrome.
 *
 * Takes the shared tally as a prop rather than calling useWorldWatch itself —
 * BroadcastFrame fetches it once so the (potentially 5000-row) global fetch
 * never doubles up.
 */
import type { WorldWatchState } from "../../lib/world-watch";
import { accentBorderRight, GLASS_BG, DEFAULT_THEME, type BroadcastTheme } from "./config";
import { StatTile, BreakdownChip, MiniBar } from "./worldStat";
import FeedSection from "./FeedSection";
import { useBroadcastTheme } from "./theme-context";

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
  const theme = useBroadcastTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
          fontSize: 12.1,
          fontWeight: 700,
          color: theme.mutedColor,
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
          fontSize: 12.1,
          fontWeight: 700,
          color: theme.mutedColor,
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
          fontSize: 12.1,
          fontWeight: 700,
          color: theme.mutedColor,
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
        background: GLASS_BG,
        ...accentBorderRight(theme.panelBorder, `5px solid ${topColor}`),
        borderRadius: 16,
        boxShadow: `0 12px 36px rgba(0,0,0,0.5), 0 0 20px ${topColor}28`,
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
          color: theme.titleColor,
        }}
      >
        <span>DETECTION GRID</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>
          LAST 24H
        </span>
      </div>

      <div style={{ display: "flex", gap: 18 }}>
        <StatTile label="ALERTS" value={s.alertTotal} color={topColor} />
        <StatTile label="SEISMIC" value={s.quakeCount} color={theme.accent} />
        <StatTile label="VOLCANIC" value={s.volcanoCount} color={volcanoColor} />
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
              graphs below are ALERTS, SEISMIC, then VOLCANIC, not one blended bar. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: "0 0 66px" }} />
            <span style={{ flex: 1, fontSize: 9.9, fontWeight: 800, letterSpacing: 1, color: topColor }}>
              ALERTS
            </span>
            <span style={{ flex: "0 0 18px" }} />
            <span
              style={{
                flex: 1,
                textAlign: "right",
                fontSize: 9.9,
                fontWeight: 800,
                letterSpacing: 1,
                color: theme.accent,
              }}
            >
              SEISMIC
            </span>
            <span style={{ flex: "0 0 18px" }} />
            <span
              style={{
                flex: 1,
                textAlign: "right",
                fontSize: 9.9,
                fontWeight: 800,
                letterSpacing: 1,
                color: volcanoColor,
              }}
            >
              VOLCANIC
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

      <FeedSection feed={s.feed} theme={theme} visible={4} />
    </div>
  );
}

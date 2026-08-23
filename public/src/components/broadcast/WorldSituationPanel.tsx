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
 * The grid is COLUMNS-DRIVEN: each report kind (alert/quake/volcano) is one
 * column spec carrying its tile, chips and continent bar, and the channel's
 * `kindsOff` (ControlState.reportKindsOff) prunes whole columns — so a seismic
 * channel's grid has no dead all-zero ALERTS column, it simply isn't there.
 *
 * Takes the shared tally as a prop rather than calling useWorldWatch itself —
 * BroadcastFrame fetches it once so the (potentially 5000-row) global fetch
 * never doubles up.
 */
import { Fragment } from "react";
import type { ReportKind } from "@photonsurge/shared/broadcast-report";
import type { WorldWatchState } from "../../lib/world-watch";
import { accentBorderRight, GLASS_BG, DEFAULT_THEME, type BroadcastTheme } from "./config";
import { StatTile, BreakdownChip, MiniBar } from "./worldStat";
import FeedSection from "./FeedSection";
import { useBroadcastTheme } from "./theme-context";

type Continent = WorldWatchState["byContinent"][number];

/** One report kind's whole slice of the grid — hero tile, breakdown chips and
 *  per-continent mini bar all hang off this, so hiding a kind for a channel
 *  drops the entire slice at once instead of leaving zeroed chrome behind. */
interface GridColumn {
  kind: ReportKind;
  label: string;
  color: string;
  total: number;
  chips: { key: string; label: string; count: number; color: string }[];
  count: (c: Continent) => number;
  segments: (c: Continent) => { key: string; color: string; count: number }[];
  /** This column's own busiest continent — each column scales independently so
   *  none silently swamps another. */
  max: number;
}

/** One "Asia [alerts bar] 129  [quakes bar] 63  [volcanoes bar] 2" row — one
 *  mini graph per VISIBLE column, each its own colour ramp and scale, so the
 *  event types never blend into one ambiguous bar. */
function ContinentRow({ continent, columns }: { continent: Continent; columns: GridColumn[] }) {
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
        {continent.continent}
      </span>
      {columns.map((col) => (
        <Fragment key={col.kind}>
          <MiniBar count={col.count(continent)} max={col.max} segments={col.segments(continent)} />
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
            {col.count(continent)}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

export default function WorldSituationPanel({
  worldWatch,
  theme = DEFAULT_THEME,
  kindsOff,
}: {
  worldWatch: WorldWatchState;
  theme?: BroadcastTheme;
  /** Per-channel hidden report kinds (ControlState.reportKindsOff) — a hidden
   *  kind loses its tile, chips row and continent column, not just its counts. */
  kindsOff?: readonly ReportKind[];
}) {
  const s = worldWatch;
  const off = new Set<ReportKind>(kindsOff ? [...kindsOff] : []);
  const topColor = (!off.has("alert") && s.bySeverity[0]?.color) || theme.accent;
  const volcanoColor = s.byVolcanoStatus[0]?.color ?? "#f97316";

  const columns: GridColumn[] = (
    [
      {
        kind: "alert",
        label: "ALERTS",
        color: topColor,
        total: s.alertTotal,
        chips: s.bySeverity.map((b) => ({ key: `sev:${b.rank}`, label: b.label, count: b.count, color: b.color })),
        count: (c: Continent) => c.alertCount,
        segments: (c: Continent) => c.bySeverity.map((b) => ({ key: `sev:${b.rank}`, color: b.color, count: b.count })),
        max: Math.max(1, ...s.byContinent.map((c) => c.alertCount)),
      },
      {
        kind: "quake",
        label: "SEISMIC",
        color: theme.accent,
        total: s.quakeCount,
        chips: s.byMagClass.map((b) => ({ key: `mag:${b.cls}`, label: b.label, count: b.count, color: b.color })),
        count: (c: Continent) => c.quakeCount,
        segments: (c: Continent) => c.byMagClass.map((b) => ({ key: `mag:${b.cls}`, color: b.color, count: b.count })),
        max: Math.max(1, ...s.byContinent.map((c) => c.quakeCount)),
      },
      {
        kind: "volcano",
        label: "VOLCANIC",
        color: volcanoColor,
        total: s.volcanoCount,
        chips: s.byVolcanoStatus.map((b) => ({ key: `volc:${b.status}`, label: b.label, count: b.count, color: b.color })),
        count: (c: Continent) => c.volcanoCount,
        segments: (c: Continent) => c.byVolcanoStatus.map((b) => ({ key: `volc:${b.status}`, color: b.color, count: b.count })),
        max: Math.max(1, ...s.byContinent.map((c) => c.volcanoCount)),
      },
    ] satisfies GridColumn[]
  ).filter((col) => !off.has(col.kind));

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

      {columns.length > 0 ? (
        <div style={{ display: "flex", gap: 18 }}>
          {columns.map((col) => (
            <StatTile key={col.kind} label={col.label} value={col.total} color={col.color} />
          ))}
        </div>
      ) : null}

      {columns.map((col) =>
        col.chips.length > 0 ? (
          <div key={col.kind} style={{ display: "flex", flexWrap: "wrap", rowGap: 6, columnGap: 14 }}>
            {col.chips.map((b) => (
              <BreakdownChip key={b.key} label={b.label} count={b.count} color={b.color} />
            ))}
          </div>
        ) : null,
      )}

      {columns.length > 0 && s.byContinent.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Column legend — once, not per row — so it's clear which mini graph
              below is which category, not one blended bar. First visible label
              sits left (over its bar's start), the rest right-align. */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: "0 0 66px" }} />
            {columns.map((col, i) => (
              <Fragment key={col.kind}>
                <span
                  style={{
                    flex: 1,
                    textAlign: i === 0 ? "left" : "right",
                    fontSize: 9.9,
                    fontWeight: 800,
                    letterSpacing: 1,
                    color: col.color,
                  }}
                >
                  {col.label}
                </span>
                <span style={{ flex: "0 0 18px" }} />
              </Fragment>
            ))}
          </div>
          {s.byContinent.map((c) => (
            <ContinentRow key={c.continent} continent={c} columns={columns} />
          ))}
        </div>
      ) : null}

      <FeedSection feed={s.feed} theme={theme} visible={4} />
    </div>
  );
}

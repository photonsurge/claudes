"use client";

/**
 * A dedicated row of individual station boxes, shown along the bottom-centre
 * of the screen (stacked above the GLOBAL MONITOR cluster) whenever a focused
 * quake event has more than one real live seismograph station nearby.
 * Separate from SeismicMonitor's compact SEISMIC MONITOR panel (which keeps
 * showing a single cycling trace for the ambient/wide-shot case) — an event
 * with several nearby stations gets each one as its own visible box instead
 * of squeezing them into one small card.
 */
import type { Segment } from "@photonsurge/shared/director";
import type { SeismoStationReading } from "../../lib/seismo/types";
import { realLinePath } from "./MonitorCluster";
import { DEFAULT_THEME, TILE_BG, type BroadcastTheme } from "./config";
import { HeartbeatIcon } from "./icons";

/** How many nearby stations to show at once — more than this and the row
 *  would run wider than is readable at 1080p. */
const MAX_SHOWN = 5;
const BOX_W = 132;
const BOX_H = 42;

function StationBox({
  station,
  primary,
  theme,
}: {
  station: SeismoStationReading;
  primary: boolean;
  theme: BroadcastTheme;
}) {
  const name = station.siteName?.split(",")[0]?.trim() || `${station.net}.${station.sta}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: BOX_W }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: 9.9,
            fontWeight: 800,
            letterSpacing: 0.4,
            color: primary ? theme.accent : "#c8d5e6",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        <span style={{ fontSize: 8.8, fontWeight: 700, color: "#9fb0c8" }}>{Math.round(station.distanceKm)} km</span>
      </div>
      <div
        style={{
          height: BOX_H,
          borderRadius: 6,
          background: TILE_BG,
          border: `1px solid ${primary ? "rgba(67,217,255,0.5)" : "rgba(90,120,160,0.25)"}`,
          overflow: "hidden",
          position: "relative",
          boxShadow: primary ? "0 0 12px rgba(67,217,255,0.25)" : undefined,
        }}
      >
        <svg
          width="200%"
          height="100%"
          viewBox={`0 0 ${BOX_W * 2} ${BOX_H}`}
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, animation: "sstation-row-trace 9s linear infinite" }}
        >
          <path d={realLinePath(station.samples, BOX_W, BOX_H)} fill="none" stroke="#43d9ff" strokeWidth="1.1" />
          <path
            d={realLinePath(station.samples, BOX_W, BOX_H)}
            transform={`translate(${BOX_W},0)`}
            fill="none"
            stroke="#43d9ff"
            strokeWidth="1.1"
          />
        </svg>
      </div>
    </div>
  );
}

export default function SeismicStationRow({
  stations,
  onAirSegment = null,
  theme = DEFAULT_THEME,
}: {
  /** Worker-cached live seismograph stations near what's on air, nearest first. */
  stations: SeismoStationReading[];
  /** The on-air director segment — the row only shows on a focused quake event. */
  onAirSegment?: Segment | null;
  theme?: BroadcastTheme;
}) {
  const isQuakeSeg = onAirSegment?.kind === "quake";
  const withData = stations.filter((s) => s.samples?.length);
  if (!isQuakeSeg || withData.length < 2) return null;

  const shown = withData.slice(0, MAX_SHOWN);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", pointerEvents: "none" }}>
      <style>{"@keyframes sstation-row-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: "#dfe7f5" }}>
        <HeartbeatIcon active size={11} />
        NEARBY SEISMOGRAPH STATIONS
      </span>
      <div style={{ display: "flex", gap: 10 }}>
        {shown.map((s, i) => (
          <StationBox key={`${s.net}.${s.sta}.${s.loc}.${s.cha}`} station={s} primary={i === 0} theme={theme} />
        ))}
      </div>
    </div>
  );
}

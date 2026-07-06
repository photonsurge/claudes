"use client";

/**
 * A dedicated row of individual tide-gauge boxes, shown along the bottom-centre
 * of the screen whenever 2+ real coastal sea-level stations are cached near
 * what's on air — TsunamiMonitor's single-gauge card hides itself once this
 * row takes over, so the two never double up. Mirrors SeismicStationRow,
 * swapping the ground-motion trace for the filled water-level wave.
 */
import type { Segment } from "@photonsurge/shared/director";
import type { TideStationReading } from "../../lib/tides/types";
import { useTideGauge } from "../../lib/tide-gauge";
import { realWavePath } from "./MonitorCluster";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { WaveIcon } from "./icons";

/** How many nearby gauges to show at once — more than this and the row would
 *  run wider than is readable at 1080p. */
const MAX_SHOWN = 5;
const BOX_W = 132;
const BOX_H = 42;

function GaugeBox({ station, primary, theme }: { station: TideStationReading; primary: boolean; theme: BroadcastTheme }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, width: BOX_W }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 0.4,
            color: primary ? theme.accent : "#c8d5e6",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {station.name}
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, color: "#9fb0c8" }}>{Math.round(station.distanceKm)} km</span>
      </div>
      <div
        style={{
          height: BOX_H,
          borderRadius: 6,
          background: "rgba(4,10,20,0.72)",
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
          style={{ position: "absolute", inset: 0, animation: "tstation-row-trace 11s linear infinite" }}
        >
          <path d={realWavePath(station.samples, BOX_W, BOX_H)} fill="rgba(60,150,230,0.5)" />
          <path d={realWavePath(station.samples, BOX_W, BOX_H)} transform={`translate(${BOX_W},0)`} fill="rgba(60,150,230,0.5)" />
        </svg>
      </div>
    </div>
  );
}

export default function TideStationRow({
  onAirSegment = null,
  regionCenter,
  theme = DEFAULT_THEME,
}: {
  /** The on-air director segment — its camera centre is the focus point. */
  onAirSegment?: Segment | null;
  /** Current camera centre [lng,lat] — the fallback focus for wide shots. */
  regionCenter?: [number, number];
  theme?: BroadcastTheme;
}) {
  const focus: [number, number] | null = onAirSegment?.camera.center ?? regionCenter ?? null;
  const { stations } = useTideGauge(focus, true);
  const withData = stations.filter((s) => s.samples?.length);
  if (withData.length < 2) return null;

  const shown = withData.slice(0, MAX_SHOWN);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", pointerEvents: "none" }}>
      <style>{"@keyframes tstation-row-trace{from{transform:translateX(0)}to{transform:translateX(-50%)}}"}</style>
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: "#dfe7f5" }}>
        <WaveIcon active size={11} />
        NEARBY TSUNAMI GAUGES
      </span>
      <div style={{ display: "flex", gap: 10 }}>
        {shown.map((s, i) => (
          <GaugeBox key={`${s.provider}.${s.stationId}`} station={s} primary={i === 0} theme={theme} />
        ))}
      </div>
    </div>
  );
}

"use client";

/**
 * "SEA TEMP PROFILE" — a vertical temperature-vs-depth chart at the on-air
 * focus, sampled live from the already-decoded texture cache (see
 * lib/depthProfile.ts — no archive, no network fetch beyond what Globe.tsx
 * already preloads). Shows all 5 depth chapters (surface/100/500/2000/5000m)
 * AT ONCE, unlike the single-chapter overlay VariablePicker switches between.
 * Self-hiding over land / wherever fewer than 2 chapters have data, same
 * "no data → no chart" convention as PointHistoryPanel.
 */
import { useEffect, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { sampleDepthProfile, type DepthProfilePoint } from "../../lib/depthProfile";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { SectionTitle, toPath, formatReading, CHART_W } from "./PointHistoryPanel";

const PANEL_W = 320;
const PANEL_PAD_X = 16;
const CHART_H = 150;
const COMPACT_PANEL_W = 220;
const COMPACT_CHART_H = 100;

/** Room reserved on each side of the plotted line for the depth/value labels. */
const LABEL_LEFT_W = 34;
const LABEL_RIGHT_W = 40;
const PAD_Y = 12;

const DEPTH_LABEL: Record<number, string> = {
  0: "SURFACE",
  100: "100m",
  500: "500m",
  2000: "2000m",
  5000: "5000m",
};

export interface ProfileRow extends DepthProfilePoint {
  x: number;
  y: number;
}

/**
 * Map sampled points onto the chart box: temperature -> x (linear, with the
 * same flat-series epsilon-widen guard PointHistoryPanel's `sparkPoints`
 * uses), depth chapter -> y as EVENLY SPACED rows (not a true-to-scale depth
 * axis — a linear 0-5000m scale would crush the top 4 chapters into the first
 * 10% of the chart, which reads as "nothing changes near the surface" when
 * the opposite is true).
 */
export function profileRows(points: DepthProfilePoint[], height: number = CHART_H): ProfileRow[] | null {
  if (points.length < 2) return null;
  const temps = points.map((p) => p.tempC);
  let min = Math.min(...temps);
  let max = Math.max(...temps);
  if (max - min < 1e-9) {
    min -= 0.5;
    max += 0.5;
  }
  const innerW = CHART_W - LABEL_LEFT_W - LABEL_RIGHT_W;
  const innerH = height - 2 * PAD_Y;
  const n = points.length;
  return points.map((p, i) => ({
    ...p,
    x: LABEL_LEFT_W + ((p.tempC - min) / (max - min)) * innerW,
    y: n === 1 ? height / 2 : PAD_Y + (i / (n - 1)) * innerH,
  }));
}

export default function DepthProfilePanel({
  center,
  manifest,
  theme = DEFAULT_THEME,
  compact = false,
}: {
  /** Focus point [lng, lat] — same source PointHistoryPanel reads. */
  center: [number, number] | null;
  manifest: WeatherManifest | null;
  theme?: BroadcastTheme;
  /** Small side-note sizing for embedding inside EventOverlay. */
  compact?: boolean;
}) {
  const [points, setPoints] = useState<DepthProfilePoint[] | null>(null);
  const lng = center?.[0] ?? null;
  const lat = center?.[1] ?? null;

  useEffect(() => {
    if (!manifest || lat == null || lng == null) {
      setPoints(null);
      return;
    }
    let cancelled = false;
    sampleDepthProfile(manifest, lat, lng).then((p) => {
      if (!cancelled) setPoints(p);
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, lat, lng]);

  const panelW = compact ? COMPACT_PANEL_W : PANEL_W;
  const chartH = compact ? COMPACT_CHART_H : CHART_H;
  const panelPadX = compact ? 12 : PANEL_PAD_X;
  const rows = points ? profileRows(points, chartH) : null;

  if (!rows) return null;

  const path = toPath(rows.map((r) => [r.x, r.y] as [number, number]));

  return (
    <div
      style={{
        width: panelW,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 6 : 10,
        padding: `${compact ? 10 : 14}px ${panelPadX}px`,
        background: theme.panelBg,
        border: theme.panelBorder,
        borderRadius: 12,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <SectionTitle title="SEA TEMP PROFILE" tag="LIVE · BY DEPTH" accent={theme.accent} />
      <svg
        width="100%"
        height={chartH}
        viewBox={`0 0 ${CHART_W} ${chartH}`}
        preserveAspectRatio="none"
        style={{ display: "block", borderRadius: 6, background: "rgba(4,10,20,0.78)" }}
      >
        <path d={path} fill="none" stroke={theme.accent} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {rows.map((r) => (
          <g key={r.depth}>
            <circle cx={r.x} cy={r.y} r={4} fill={theme.accent} stroke="#040a14" strokeWidth={1.5} />
            <text x={2} y={r.y + 3} fontSize={9.5} fontWeight={750} fill="#9db0ca">
              {DEPTH_LABEL[r.depth] ?? `${r.depth}m`}
            </text>
            <text x={CHART_W - 2} y={r.y + 3} fontSize={10.5} fontWeight={800} fill="#f3f7ff" textAnchor="end">
              {formatReading(r.tempC)}°
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

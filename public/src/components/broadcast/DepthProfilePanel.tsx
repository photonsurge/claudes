"use client";

/**
 * "SEA TEMP PROFILE" — a colour-coded water-column strip at the on-air focus,
 * sampled live from the already-decoded texture cache (see
 * lib/depthProfile.ts — no archive, no network fetch beyond what Globe.tsx
 * already preloads). Shows all 5 depth chapters (surface/100/500/2000/5000m)
 * AT ONCE, unlike the single-chapter overlay VariablePicker switches between.
 *
 * Each band is coloured with the SAME "sst" palette (and that chapter's OWN
 * colour domain — see depthProfile.ts) used to paint that variable on the
 * globe, so the panel reads as an extension of the map's colour language
 * instead of an abstract chart. Self-hiding over land / wherever fewer than
 * 2 chapters have data, same "no data → no chart" convention as
 * PointHistoryPanel.
 */
import { useEffect, useState } from "react";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { getPalette, type Palette } from "@photonsurge/shared/palettes";
import { sampleDepthProfile, type DepthProfilePoint } from "../../lib/depthProfile";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { SectionTitle, formatReading } from "./PointHistoryPanel";

const PANEL_W = 320;
const PANEL_PAD_X = 16;
const ROW_H = 30;
const ROW_GAP = 3;

const COMPACT_PANEL_W = 220;
const COMPACT_ROW_H = 22;

const DEPTH_LABEL: Record<number, string> = {
  0: "SURFACE",
  100: "100m",
  500: "500m",
  2000: "2000m",
  5000: "5000m",
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linearly interpolate a hex colour from a palette at a normalised stop (0..1). */
export function colorAtStop(palette: Palette, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  let lo = palette[0];
  let hi = palette[palette.length - 1];
  for (let i = 0; i < palette.length - 1; i++) {
    if (clamped >= palette[i][0] && clamped <= palette[i + 1][0]) {
      lo = palette[i];
      hi = palette[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const f = span > 0 ? (clamped - lo[0]) / span : 0;
  const a = hexToRgb(lo[1]);
  const b = hexToRgb(hi[1]);
  return rgbToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

/** Map a physical value to its palette colour over the variable's OWN domain
 *  — deliberately per-chapter, not one shared range (see depthProfile.ts). */
export function colorForValue(palette: Palette, domain: [number, number], value: number): string {
  const [min, max] = domain;
  const t = max > min ? (value - min) / (max - min) : 0;
  return colorAtStop(palette, t);
}

/** White or near-black text, whichever reads clearly against `bg`. */
export function textColorFor(bg: string): string {
  const [r, g, b] = hexToRgb(bg);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0a0e16" : "#f3f7ff";
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

  if (!points) return null;

  const panelW = compact ? COMPACT_PANEL_W : PANEL_W;
  const rowH = compact ? COMPACT_ROW_H : ROW_H;
  const panelPadX = compact ? 12 : PANEL_PAD_X;

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
      <div style={{ display: "flex", flexDirection: "column", gap: ROW_GAP }}>
        {points.map((p) => {
          const bg = colorForValue(getPalette(p.palette), p.domain, p.tempC);
          const fg = textColorFor(bg);
          return (
            <div
              key={p.depth}
              style={{
                height: rowH,
                borderRadius: 6,
                background: bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 10px",
                boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
              }}
            >
              <span style={{ fontSize: compact ? 9.5 : 11, fontWeight: 800, letterSpacing: 0.8, color: fg }}>
                {DEPTH_LABEL[p.depth] ?? `${p.depth}m`}
              </span>
              <span style={{ fontSize: compact ? 11 : 13, fontWeight: 850, color: fg }}>
                {formatReading(p.tempC)}°
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

/**
 * The top-centre horizontal colour scale ("INTENSITY METER" / "THREAT MATRIX"): the
 * active weather variable's palette as a gradient bar with a few value labels.
 * Renders nothing when no scalar map is on air.
 */
import type { ControlState } from "@photonsurge/shared/control";
import { getVariable } from "@photonsurge/shared/variables";
import { getPalette } from "@photonsurge/shared/palettes";
import { buildLegend } from "../../lib/legend";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";

export default function IntensityMeter({
  variable,
  units,
  theme = DEFAULT_THEME,
  compact = false,
}: {
  variable: string | null;
  units: ControlState["units"];
  theme?: BroadcastTheme;
  compact?: boolean;
}) {
  if (!variable) return null;
  const meta = getVariable(variable);
  const legend = buildLegend(variable, units);
  if (!meta || !legend) return null;

  const palette = getPalette(meta.palette);
  // Horizontal gradient: low value on the LEFT, so stops run low%→high% left to right.
  const gradient = `linear-gradient(to right, ${palette
    .map(([stop, hex]) => `${hex} ${Math.round(stop * 100)}%`)
    .join(", ")})`;
  const barW = compact ? 260 : 360;
  // Nearest palette colour at a normalised position, for the accent underline.
  const hexAt = (t: number) => {
    let best = palette[0][1];
    let bd = Infinity;
    for (const [stop, hex] of palette) {
      const d = Math.abs(stop - t);
      if (d < bd) {
        bd = d;
        best = hex;
      }
    }
    return best;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        color: "#dfe7f5",
      }}
    >
      {/* Hero: the ACTIVE MAP TYPE, big and unmissable — this is what viewers
          need to read first. The meter title becomes a small eyebrow above it. */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1.8,
            opacity: 0.7,
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          {theme.meterTitle}
        </div>
        <div
          style={{
            fontSize: compact ? 19 : 24,
            fontWeight: 800,
            letterSpacing: 0.3,
            lineHeight: 1.05,
            color: "#fff",
            marginTop: 2,
            textShadow: "0 1px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)",
          }}
        >
          {meta.label}
          {legend.unit ? (
            <span style={{ fontSize: compact ? 13 : 15, fontWeight: 700, color: hexAt(1), marginLeft: 6 }}>
              {legend.unit}
            </span>
          ) : null}
        </div>
      </div>
      <div
        style={{
          width: barW,
          height: compact ? 14 : 19,
          borderRadius: 5,
          background: gradient,
          border: "1px solid rgba(0,0,0,0.6)",
          boxShadow: "0 4px 14px rgba(0,0,0,0.5), inset 0 0 6px rgba(0,0,0,0.4)",
        }}
      />
      <div
        style={{
          width: barW,
          display: "flex",
          justifyContent: "space-between",
          fontSize: compact ? 10.5 : 12,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {legend.stops.map((s, i) => (
          <span
            key={i}
            style={{
              color: hexAt(s.t),
              opacity: 0.95,
              whiteSpace: "nowrap",
              textShadow: "0 1px 4px rgba(0,0,0,0.9)",
            }}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

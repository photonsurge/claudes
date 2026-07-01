"use client";

/**
 * The left-edge vertical colour scale ("INTENSITY METER" / "THREAT MATRIX"): the
 * active weather variable's palette as a gradient bar with a few value labels and
 * chevron cues. Renders nothing when no scalar map is on air.
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
  // Vertical gradient: high value at the TOP, so stops run 100%→0% down the bar.
  const gradient = `linear-gradient(to top, ${palette
    .map(([stop, hex]) => `${hex} ${Math.round(stop * 100)}%`)
    .join(", ")})`;
  const barH = compact ? 150 : 210;
  // Top → bottom labels (reverse of the low→high stops).
  const labels = [...legend.stops].reverse();
  // Nearest palette colour at a normalised position, for the per-band chevrons.
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
        gap: 8,
        padding: compact ? "8px 9px" : "10px 12px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderRadius: 12,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        color: "#dfe7f5",
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, opacity: 0.7 }}>
        {theme.meterTitle}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <div
          style={{
            width: compact ? 14 : 18,
            height: barH,
            borderRadius: 5,
            background: gradient,
            border: "1px solid rgba(0,0,0,0.5)",
            boxShadow: "inset 0 0 6px rgba(0,0,0,0.4)",
          }}
        />
        <div
          style={{
            height: barH,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontSize: compact ? 9 : 10,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {labels.map((s, i) => (
            <span
              key={i}
              style={{ opacity: 0.9, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}
            >
              <span style={{ color: hexAt(s.t), fontWeight: 900, textShadow: "0 0 4px rgba(0,0,0,0.6)" }}>
                ❯
              </span>
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 9, opacity: 0.6, letterSpacing: 0.6 }}>{meta.label}</div>
    </div>
  );
}

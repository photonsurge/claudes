"use client";

/**
 * The top-centre horizontal colour scale ("INTENSITY METER" / "THREAT MATRIX"): the
 * active weather variable's palette as a gradient bar with a few value labels.
 * Renders nothing when no scalar map is on air.
 */
import type { ControlState } from "@photonsurge/shared/control";
import { getVariable } from "@photonsurge/shared/variables";
import { getPalette } from "@photonsurge/shared/palettes";
import { satImgCaptionFor } from "@photonsurge/shared/satimg/types";
import { buildLegend } from "../../lib/legend";
import type { MapFreshness } from "../../lib/manifest";
import type { BroadcastTheme } from "./config";

export default function IntensityMeter({
  variable,
  units,
  compact = false,
  showSatImg,
  satImgFeeds,
  freshness,
}: {
  variable: string | null;
  units: ControlState["units"];
  theme?: BroadcastTheme;
  compact?: boolean;
  /** Satellite-imagery state — there's no scalar legend for photographic feeds,
   *  so when `variable` is null this renders a feed/look caption instead. */
  showSatImg?: boolean;
  satImgFeeds?: ControlState["satImgFeeds"];
  /** Supplier and timestamps for the active map variable. */
  freshness?: MapFreshness | null;
}) {
  const sat = satImgCaptionFor(showSatImg, satImgFeeds);

  if (!variable) {
    if (!sat) return null;
    return (
      <div style={{ textAlign: "center", pointerEvents: "none", fontFamily: "system-ui, sans-serif" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1.8,
            opacity: 0.7,
            color: "#dfe7f5",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          LIVE IMAGERY
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
          {sat.title}
        </div>
        <div style={{ fontSize: compact ? 11 : 12.5, opacity: 0.85, color: "#dfe7f5", marginTop: 2 }}>
          {sat.subtitle}
        </div>
      </div>
    );
  }
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
        transform: "translateY(-22px)",
      }}
    >
      {/* Hero: the ACTIVE MAP TYPE, big and unmissable — this is what viewers
          need to read first, followed by the active source/timing metadata. */}
      <div style={{ textAlign: "center" }}>
        {freshness ? (
          <div
            style={{
              marginTop: 2,
              fontSize: compact ? 10.5 : 12,
              fontWeight: 800,
              letterSpacing: 0.9,
              color: "#dfe7f5",
              opacity: 0.82,
              textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            }}
          >
            SOURCE {freshness.source}
            {freshness.generatedLabel ? ` · CREATED ${freshness.generatedLabel}` : ""}
            {freshness.updatedLabel ? ` (${freshness.updatedLabel})` : ""}
            {freshness.runLabel ? ` · RUN ${freshness.runLabel}` : ""}
          </div>
        ) : null}
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
      {/* The `global` satellite feed drapes over whatever variable is on air
          (see satimg-feature memory), so the meter above is showing the
          variable's legend, not the imagery's — without this, live satellite
          cloud cover appears on the globe with no on-screen indication at all. */}
      {sat ? (
        <div
          style={{
            fontSize: compact ? 10 : 11,
            fontWeight: 700,
            opacity: 0.8,
            color: "#dfe7f5",
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            marginTop: -2,
          }}
        >
          🛰 {sat.subtitle}
        </div>
      ) : null}
    </div>
  );
}

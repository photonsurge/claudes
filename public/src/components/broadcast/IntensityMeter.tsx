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
import { TILE_BG, type BroadcastTheme } from "./config";
import { useBroadcastTheme } from "./theme-context";

export default function IntensityMeter({
  variable,
  units,
  theme: propTheme,
  compact = false,
  showSatImg,
  satImgFeeds,
  freshness,
  part = "all",
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
  /** Which half to render: "title" is the map-type hero + source/timing chip
   *  (the masthead band next to the logo), "scale" is the colour-scale pill
   *  (top-centre, under the crawl). "all" stacks both — the pre-split layout,
   *  used when the brand block (and its masthead band) is off. */
  part?: "title" | "scale" | "all";
}) {
  const theme = useBroadcastTheme(propTheme);
  const sat = satImgCaptionFor(showSatImg, satImgFeeds);

  if (!variable) {
    // Photographic feed only: all the meter has is a caption — a "title".
    if (!sat || part === "scale") return null;
    return (
      <div
        style={{
          textAlign: "center",
          pointerEvents: "none",
          fontFamily: "system-ui, sans-serif",
          // Same one-plate treatment as the map-type hero below.
          padding: "8px 24px",
          borderRadius: 14,
          background: TILE_BG,
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <div
          style={{
            fontSize: 12.7,
            fontWeight: 800,
            letterSpacing: 1.8,
            opacity: 0.7,
            color: theme.titleColor,
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
          }}
        >
          {theme.meterTitle}
        </div>
        <div
          style={{
            fontSize: compact ? 24.2 : 30.8,
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
        <div style={{ fontSize: compact ? 13.2 : 15.4, opacity: 0.85, color: theme.titleColor, marginTop: 2 }}>
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
  const barW = compact ? 290 : 400;
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
  // Tick text sits on the dark scale pill — lift too-dark palette colours
  // (deep blues at the low end of wind/rain ramps) toward white so every stop
  // stays legible.
  const tickColor = (t: number) => {
    const hex = hexAt(t);
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum >= 110) return hex;
    const k = (110 - lum) / 110;
    const up = (c: number) => Math.round(c + (235 - c) * k);
    return `rgb(${up(r)}, ${up(g)}, ${up(b)})`;
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
        color: theme.titleColor,
      }}
    >
      {/* Hero: the ACTIVE MAP TYPE + its source/timing metadata on ONE dark
          plate — a single widget rather than bare hero text floating over a
          bright basemap with a separate chip beside it. */}
      {part !== "scale" ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          textAlign: "center",
          padding: "8px 24px",
          borderRadius: 14,
          background: TILE_BG,
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <div
          style={{
            fontSize: compact ? 24.2 : 30.8,
            fontWeight: 800,
            letterSpacing: 0.3,
            lineHeight: 1.05,
            color: "#fff",
            whiteSpace: "nowrap",
            textShadow: "0 1px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)",
          }}
        >
          {meta.label}
          {legend.unit ? (
            <span style={{ fontSize: compact ? 16 : 18.7, fontWeight: 700, color: hexAt(1), marginLeft: 6 }}>
              {legend.unit}
            </span>
          ) : null}
        </div>
        {freshness ? (
          <div
            style={{
              borderLeft: "1px solid rgba(255,255,255,0.14)",
              paddingLeft: 16,
              fontSize: compact ? 13.2 : 15.4,
              fontWeight: 800,
              letterSpacing: 1.1,
              color: theme.titleColor,
              whiteSpace: "nowrap",
            }}
          >
            SOURCE {freshness.source}
            {freshness.generatedLabel ? ` · CREATED ${freshness.generatedLabel}` : ""}
            {freshness.updatedLabel ? ` (${freshness.updatedLabel})` : ""}
            {freshness.runLabel ? ` · RUN ${freshness.runLabel}` : ""}
          </div>
        ) : null}
      </div>
      ) : null}
      {part === "title" ? null : (
      <>
      {/* Scale pill: bar + tick labels on their own dark panel, matching the
          card chrome — the palette-coloured tick text is unreadable straight
          over a light basemap. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          padding: "9px 12px 7px",
          borderRadius: 11,
          background: TILE_BG,
          border: "1px solid rgba(255,255,255,0.09)",
          boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      >
        <div
          style={{
            width: barW,
            height: compact ? 14 : 19,
            borderRadius: 5,
            background: gradient,
            border: "1px solid rgba(0,0,0,0.6)",
            boxShadow: "inset 0 0 6px rgba(0,0,0,0.4)",
          }}
        />
        <div
          style={{
            width: barW,
            display: "flex",
            justifyContent: "space-between",
            fontSize: compact ? 12.7 : 14.3,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {legend.stops.map((s, i) => (
            <span
              key={i}
              style={{
                color: tickColor(s.t),
                whiteSpace: "nowrap",
                textShadow: "0 1px 3px rgba(0,0,0,0.9)",
              }}
            >
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {/* The `global` satellite feed drapes over whatever variable is on air
          (see satimg-feature memory), so the meter above is showing the
          variable's legend, not the imagery's — without this, live satellite
          cloud cover appears on the globe with no on-screen indication at all. */}
      {sat ? (
        <div
          style={{
            fontSize: compact ? 12.1 : 13.2,
            fontWeight: 700,
            opacity: 0.8,
            color: theme.titleColor,
            textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            marginTop: -2,
          }}
        >
          🛰 {sat.subtitle}
        </div>
      ) : null}
      </>
      )}
    </div>
  );
}

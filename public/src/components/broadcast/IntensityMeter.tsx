"use client";

/**
 * The active-map widget: the on-air variable's name, its source/timing
 * metadata and its palette as a labelled gradient bar. With the brand block on
 * it renders as ONE masthead plate (part="masthead") — title + source chip on
 * top, colour scale and the world clocks docked beneath; with the brand off it
 * falls back to the stacked top-centre layout (part="all").
 */
import type { ControlState } from "@photonsurge/shared/control";
import { getVariable } from "@photonsurge/shared/variables";
import { getPalette } from "@photonsurge/shared/palettes";
import { satImgCaptionFor } from "@photonsurge/shared/satimg/types";
import { buildLegend } from "../../lib/legend";
import type { MapFreshness } from "../../lib/manifest";
import { TILE_BG, type BroadcastTheme } from "./config";
import { useBroadcastTheme } from "./theme-context";

/** Shared plate chrome for every layout below. */
const PLATE: React.CSSProperties = {
  background: TILE_BG,
  border: "1px solid rgba(255,255,255,0.09)",
  boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
};

const DIVIDER = "1px solid rgba(255,255,255,0.14)";

export default function IntensityMeter({
  variable,
  units,
  theme: propTheme,
  compact = false,
  showSatImg,
  satImgFeeds,
  freshness,
  paletteId,
  part = "all",
  clocks,
}: {
  variable: string | null;
  units: ControlState["units"];
  theme?: BroadcastTheme;
  compact?: boolean;
  /** Palette actually painting the screen when it differs from the variable's
   *  default — e.g. height-coloured elevation contour LINES use the brighter
   *  `elevation_line` ramp, not the relief fill ramp (see legendPaletteFor). */
  paletteId?: string | null;
  /** Satellite-imagery state — there's no scalar legend for photographic feeds,
   *  so when `variable` is null this renders a feed/look caption instead. */
  showSatImg?: boolean;
  satImgFeeds?: ControlState["satImgFeeds"];
  /** Supplier and timestamps for the active map variable. */
  freshness?: MapFreshness | null;
  /** Which layout: "masthead" is the single masthead plate (map-type hero +
   *  source/timing chip on top, colour scale + clocks beneath) riding the band
   *  next to the logo when the brand block is on; "all" stacks a hero plate
   *  over a separate scale pill — the pre-split top-centre layout used when
   *  the brand block (and its masthead band) is off. */
  part?: "masthead" | "all";
  /** World-clock strip to dock in the masthead plate's bottom row (only
   *  rendered by part="masthead"). */
  clocks?: React.ReactNode;
}) {
  const theme = useBroadcastTheme(propTheme);
  const sat = satImgCaptionFor(showSatImg, satImgFeeds);

  const meta = variable ? getVariable(variable) : null;
  const legend = variable ? buildLegend(variable, units) : null;
  const hasScale = Boolean(meta && legend);

  const palette = hasScale ? getPalette(paletteId ?? meta!.palette) : null;
  // Horizontal gradient: low value on the LEFT, so stops run low%→high% left to right.
  const gradient = palette
    ? `linear-gradient(to right, ${palette
        .map(([stop, hex]) => `${hex} ${Math.round(stop * 100)}%`)
        .join(", ")})`
    : "";
  // Nearest palette colour at a normalised position, for the accent underline.
  const hexAt = (t: number) => {
    if (!palette) return "#fff";
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

  const freshnessText = freshness
    ? `SOURCE ${freshness.source}` +
      (freshness.generatedLabel ? ` · CREATED ${freshness.generatedLabel}` : "") +
      (freshness.updatedLabel ? ` (${freshness.updatedLabel})` : "") +
      (freshness.runLabel ? ` · RUN ${freshness.runLabel}` : "")
    : null;

  const heroStyle: React.CSSProperties = {
    fontSize: compact ? 24.2 : 30.8,
    fontWeight: 800,
    letterSpacing: 0.3,
    lineHeight: 1.05,
    color: "#fff",
    whiteSpace: "nowrap",
    textShadow: "0 1px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)",
  };
  const chipStyle: React.CSSProperties = {
    borderLeft: DIVIDER,
    paddingLeft: 16,
    fontSize: compact ? 13.2 : 15.4,
    fontWeight: 800,
    letterSpacing: 1.1,
    color: theme.titleColor,
    whiteSpace: "nowrap",
  };

  const scaleBar = (barW: number) =>
    hasScale ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
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
          {legend!.stops.map((s, i) => (
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
    ) : null;

  // The `global` satellite feed drapes over whatever variable is on air
  // (see satimg-feature memory), so the scale is showing the variable's
  // legend, not the imagery's — without this, live satellite cloud cover
  // appears on the globe with no on-screen indication at all.
  const satNote =
    hasScale && sat ? (
      <div
        style={{
          fontSize: compact ? 12.1 : 13.2,
          fontWeight: 700,
          opacity: 0.8,
          color: theme.titleColor,
          textShadow: "0 1px 4px rgba(0,0,0,0.8)",
        }}
      >
        🛰 {sat.subtitle}
      </div>
    ) : null;

  if (part === "masthead") {
    // Hero row: the active map type + source chip; a photographic feed with no
    // scalar shows its feed caption instead.
    const hero = hasScale
      ? { title: meta!.label, unit: legend!.unit, chip: freshnessText }
      : sat
        ? { title: sat.title, unit: null, chip: sat.subtitle }
        : null;
    if (!hero && !clocks) return null;
    const bar = scaleBar(compact ? 290 : 330);
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "10px 24px",
          borderRadius: 14,
          ...PLATE,
          pointerEvents: "none",
          fontFamily: "system-ui, sans-serif",
          color: theme.titleColor,
        }}
      >
        {hero ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={heroStyle}>
              {hero.title}
              {hero.unit ? (
                <span
                  style={{
                    fontSize: compact ? 16 : 18.7,
                    fontWeight: 700,
                    color: hexAt(1),
                    marginLeft: 6,
                  }}
                >
                  {hero.unit}
                </span>
              ) : null}
            </div>
            {hero.chip ? <div style={chipStyle}>{hero.chip}</div> : null}
          </div>
        ) : null}
        {bar || satNote || clocks ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {bar}
            {satNote ? (
              <div style={bar ? { borderLeft: DIVIDER, paddingLeft: 16 } : undefined}>
                {satNote}
              </div>
            ) : null}
            {clocks ? (
              <div
                style={
                  bar || satNote
                    ? { borderLeft: DIVIDER, paddingLeft: 16 }
                    : undefined
                }
              >
                {clocks}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (!hasScale) {
    // Photographic feed only: all the meter has is a caption — a "title".
    if (!sat) return null;
    return (
      <div
        style={{
          textAlign: "center",
          pointerEvents: "none",
          fontFamily: "system-ui, sans-serif",
          // Same one-plate treatment as the map-type hero below.
          padding: "8px 24px",
          borderRadius: 14,
          ...PLATE,
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
        <div style={{ ...heroStyle, whiteSpace: undefined, marginTop: 2 }}>
          {sat.title}
        </div>
        <div
          style={{
            fontSize: compact ? 13.2 : 15.4,
            opacity: 0.85,
            color: theme.titleColor,
            marginTop: 2,
          }}
        >
          {sat.subtitle}
        </div>
      </div>
    );
  }

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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          textAlign: "center",
          padding: "8px 24px",
          borderRadius: 14,
          ...PLATE,
        }}
      >
        <div style={heroStyle}>
          {meta!.label}
          {legend!.unit ? (
            <span
              style={{
                fontSize: compact ? 16 : 18.7,
                fontWeight: 700,
                color: hexAt(1),
                marginLeft: 6,
              }}
            >
              {legend!.unit}
            </span>
          ) : null}
        </div>
        {freshnessText ? <div style={chipStyle}>{freshnessText}</div> : null}
      </div>
      {/* Scale pill: bar + tick labels on their own dark panel, matching the
          card chrome — the palette-coloured tick text is unreadable straight
          over a light basemap. */}
      <div
        style={{
          padding: "9px 12px 7px",
          borderRadius: 11,
          ...PLATE,
          boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
        }}
      >
        {scaleBar(compact ? 290 : 400)}
      </div>
      {satNote ? <div style={{ marginTop: -2 }}>{satNote}</div> : null}
    </div>
  );
}

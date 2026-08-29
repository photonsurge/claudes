"use client";

/**
 * The active-map widget: the on-air variable's name, its source/timing
 * metadata and its palette as a labelled gradient bar, on the shared G.O.D.S.
 * chamfered panel chrome (GodsPanel) — Saira title + hairline rule, mono
 * provenance line, square-cornered scale bar with mono ticks. With the brand
 * block on it renders as ONE masthead plate (part="masthead") — title +
 * source line on top, colour scale beneath; with the brand off it falls back
 * to a single stacked legend strip (part="all"). No clocks here — the wall
 * times live in the masthead banner (GodsBanner).
 */
import type { ControlState } from "@photonsurge/shared/control";
import { getVariable } from "@photonsurge/shared/variables";
import { getPalette } from "@photonsurge/shared/palettes";
import { satImgCaptionFor } from "@photonsurge/shared/satimg/types";
import { buildLegend } from "../../lib/legend";
import type { MapFreshness } from "../../lib/manifest";
import { type BroadcastTheme } from "./config";
import { useBroadcastTheme } from "./theme-context";
import {
  GodsPanel,
  accentRule,
  MONO,
  INK,
  INK_DIM,
  INK_FAINT,
  GODS_BORDER,
} from "./GodsPanel";

/** Vertical divider between the docked bar / sat note / clocks slots. */
const DIVIDER = `1px solid ${GODS_BORDER}`;

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
   *  source/timing line on top, colour scale beneath) riding the band next to
   *  the logo when the brand block is on; "all" is the stand-alone legend
   *  strip used top-centre when the brand block is off. */
  part?: "masthead" | "all";
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
  // Nearest palette colour at a normalised position, for the tick ink.
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
  // Tick text sits on the dark panel — lift too-dark palette colours (deep
  // blues at the low end of wind/rain ramps) toward white so every stop stays
  // legible.
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
      (freshness.note ? ` · ${freshness.note}` : "") +
      (freshness.generatedLabel ? ` · CREATED ${freshness.generatedLabel}` : "") +
      (freshness.updatedLabel ? ` (${freshness.updatedLabel})` : "") +
      (freshness.runLabel ? ` · RUN ${freshness.runLabel}` : "")
    : null;

  /** Title row: map-type name + mono unit + accent hairline running out right. */
  const titleRow = (title: string, unit: string | null) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <div
        style={{
          color: INK,
          fontSize: compact ? 20 : 24,
          fontWeight: 500,
          letterSpacing: 0.4,
          lineHeight: 1.05,
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
      {unit ? (
        <div style={{ color: theme.accent, fontFamily: MONO, fontSize: compact ? 12.5 : 14 }}>{unit}</div>
      ) : null}
      <div style={{ flex: 1, minWidth: 36, height: 1, background: accentRule(theme.accent) }} />
    </div>
  );

  /** Mono provenance line under the title. */
  const metaLine = (text: string) => (
    <div style={{ color: INK_FAINT, fontFamily: MONO, fontSize: compact ? 11.5 : 12.5, letterSpacing: 0.8 }}>
      {text}
    </div>
  );

  /** Bar + ticks. No `barW` → fills whatever width the plate's widest row
   *  (usually the mono provenance line) established, so the scale never sits
   *  as a stub inside a wider plate. */
  const scaleBar = (barW?: number) =>
    hasScale ? (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 7,
          ...(barW == null ? { flex: 1, minWidth: 0 } : {}),
        }}
      >
        <div
          style={{
            width: barW ?? "100%",
            boxSizing: "border-box",
            height: compact ? 12 : 14,
            border: `1px solid ${GODS_BORDER}`,
            background: gradient,
          }}
        />
        <div
          style={{
            width: barW ?? "100%",
            boxSizing: "border-box",
            display: "flex",
            justifyContent: "space-between",
            fontFamily: MONO,
            fontSize: compact ? 11.5 : 12.5,
            letterSpacing: 0.5,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {legend!.stops.map((s, i) => (
            <span key={i} style={{ color: tickColor(s.t), whiteSpace: "nowrap" }}>
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
      <div style={{ fontSize: compact ? 11.5 : 12.5, color: INK_DIM, whiteSpace: "nowrap" }}>
        🛰 {sat.subtitle}
      </div>
    ) : null;

  if (part === "masthead") {
    // Hero row: the active map type + source line; a photographic feed with no
    // scalar shows its feed caption instead.
    const hero = hasScale
      ? { title: meta!.label, unit: legend!.unit, chip: freshnessText }
      : sat
        ? { title: sat.title, unit: null, chip: sat.subtitle }
        : null;
    if (!hero) return null;
    const bar = scaleBar();
    return (
      <GodsPanel
        notch={[12, 20]}
        padding={compact ? "10px 20px 12px" : "12px 24px 14px"}
        gap={10}
        style={{ pointerEvents: "none" }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {titleRow(hero.title, hero.unit)}
          {hero.chip ? metaLine(hero.chip) : null}
        </div>
        {bar || satNote ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {bar}
            {satNote ? (
              <div style={bar ? { borderLeft: DIVIDER, paddingLeft: 16 } : undefined}>{satNote}</div>
            ) : null}
          </div>
        ) : null}
      </GodsPanel>
    );
  }

  if (!hasScale) {
    // Photographic feed only: all the meter has is a caption — a "title".
    if (!sat) return null;
    return (
      <GodsPanel
        notch={[12, 20]}
        padding={compact ? "12px 22px 14px" : "14px 26px 16px"}
        gap={6}
        style={{ pointerEvents: "none" }}
      >
        <div
          style={{
            color: INK_FAINT,
            fontFamily: MONO,
            fontSize: 11.5,
            letterSpacing: 1.8,
          }}
        >
          {theme.meterTitle}
        </div>
        {titleRow(sat.title, null)}
        <div style={{ fontSize: compact ? 12.5 : 14, color: INK_DIM }}>{sat.subtitle}</div>
      </GodsPanel>
    );
  }

  // Stand-alone legend strip (brand off): title + provenance + scale on ONE
  // chamfered plate, top-centre.
  const stripW = compact ? 400 : 520;
  const stripPad = compact ? 22 : 26;
  return (
    <GodsPanel
      width={stripW}
      notch={[12, 20]}
      padding={`16px ${stripPad}px 18px`}
      gap={12}
      style={{ pointerEvents: "none" }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {titleRow(meta!.label, legend!.unit)}
        {freshnessText ? metaLine(freshnessText) : null}
      </div>
      {scaleBar(stripW - 2 * stripPad - 3)}
      {satNote}
    </GodsPanel>
  );
}

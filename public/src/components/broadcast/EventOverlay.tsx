"use client";

/**
 * The "EVENT DETECTION OVERLAY" reticle: a tilted, corner-bracketed targeting
 * frame around the on-air subject (which the director keeps centred), with the
 * event name as a designed lower-third beneath it — the signature element of the
 * reference broadcast. Colour tracks the segment kind. Pure CSS, inside the
 * scaled design stage.
 *
 * The tracking-detail readout (STATUS / TYPE / COUNTRY …) no longer hangs off
 * the frame at all — it's the exported EventTrackingLabel, a block BroadcastFrame
 * passes into the mode deck's chrome (DeckChrome.tracking) so it renders INSIDE
 * the bottom-left deck card, pinned under the badge + title bar. Part of the
 * card's fixed header, it stays on screen for the whole segment no matter which
 * slide rotates beneath it.
 */
import type { CSSProperties } from "react";
import type { Segment } from "@photonsurge/shared/director";
import { STAGE_W, STAGE_H } from "./useStageScale";
import { KIND_COLOR } from "./kinds";
import { TILE_BG } from "./config";
import { KindGlyph } from "./glyphs";
import { DIVIDER } from "./BroadcastCard";

const W = 660;
const H = 440;

/**
 * Reticle-bound readout anchor — offsets (design px) from the frame's own edges,
 * so the data panel hangs off the target frame and travels with it rather than
 * pinning to a screen corner:
 *   • HISTORY — point-history, top-right, pushed out to the right
 * (The 3-day forecast strip no longer hangs off the reticle at all — it rides
 * BroadcastFrame's bottom-centre monitor row as a flex item, so it and the
 * monitor cards sit beside each other instead of colliding on one baseline.)
 */
// NB: the hung readout renders at scale 1.15 (see below), so this anchor also
// keeps it CLEAR of the enlarged corner panels: HISTORY must stop short of the
// top-right WORLD WATCH column (left edge ~1452) so the two don't touch.
const HISTORY_POS = { top: -44, right: -96 };

/**
 * The reticle's targeting marks, drawn in one SVG (viewBox = design pixels) so
 * it tilts with the frame: double-stroke corner brackets (an outer L + a thinner
 * inner L, the "instrument-grade" look) plus a short alignment tick at the
 * midpoint of each edge — the marks a camera viewfinder / detection HUD uses to
 * say "locked on centre".
 */
function ReticleMarks({ color }: { color: string }) {
  const outer = 42; // corner L arm length
  const inGap = 8; // inner L offset from the edge
  const inLen = 24; // inner L arm length
  const tick = 16; // edge-midpoint tick length
  const cx = W / 2;
  const cy = H / 2;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, filter: `drop-shadow(0 0 5px ${color}55)` }}
      aria-hidden
    >
      <g fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
        <path d={`M2 ${outer} L2 2 L${outer} 2`} />
        <path d={`M${W - 2} ${outer} L${W - 2} 2 L${W - outer} 2`} />
        <path d={`M2 ${H - outer} L2 ${H - 2} L${outer} ${H - 2}`} />
        <path d={`M${W - 2} ${H - outer} L${W - 2} ${H - 2} L${W - outer} ${H - 2}`} />
        {/* edge alignment ticks */}
        <path d={`M${cx} 2 L${cx} ${2 + tick}`} />
        <path d={`M${cx} ${H - 2} L${cx} ${H - 2 - tick}`} />
        <path d={`M2 ${cy} L${2 + tick} ${cy}`} />
        <path d={`M${W - 2} ${cy} L${W - 2 - tick} ${cy}`} />
      </g>
      <g fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.5">
        <path d={`M${inGap} ${inGap + inLen} L${inGap} ${inGap} L${inGap + inLen} ${inGap}`} />
        <path d={`M${W - inGap} ${inGap + inLen} L${W - inGap} ${inGap} L${W - inGap - inLen} ${inGap}`} />
        <path d={`M${inGap} ${H - inGap - inLen} L${inGap} ${H - inGap} L${inGap + inLen} ${H - inGap}`} />
        <path d={`M${W - inGap} ${H - inGap - inLen} L${W - inGap} ${H - inGap} L${W - inGap - inLen} ${H - inGap}`} />
      </g>
    </svg>
  );
}

export default function EventOverlay({
  segment,
  historyPanel,
}: {
  segment: Segment;
  /** Point-history trend, hung off the reticle's top-right (HISTORY_POS). */
  historyPanel?: React.ReactNode;
}) {
  const color = KIND_COLOR[segment.kind] ?? "#38bdf8";
  const name = segment.title.toUpperCase();

  const left = (STAGE_W - W) / 2;
  const top0 = (STAGE_H - H) / 2 - 40;

  return (
    <div style={{ position: "absolute", left, top: top0, width: W, height: H, pointerEvents: "none" }}>
      <style>{`@keyframes bcast-reticle-scan{0%{transform:translateY(0);opacity:0}12%{opacity:0.5}88%{opacity:0.5}100%{transform:translateY(${H - 20}px);opacity:0}}@media (prefers-reduced-motion:reduce){.bcast-reticle-scan{display:none}}`}</style>
      {/* Tilted reticle frame — targeting marks + a slow scan sweep read as a live
          "detection lock" on the centred subject. overflow:hidden clips the sweep
          to the frame; all marks sit at a ≥2px inset so nothing is cropped. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: "perspective(1500px) rotateX(11deg) rotateY(-9deg)",
          transformOrigin: "center center",
          border: `1px solid ${color}55`,
          borderRadius: 6,
          background: `linear-gradient(180deg, ${color}0d, rgba(10,16,28,0.02))`,
          boxShadow: `inset 0 0 40px ${color}14`,
          overflow: "hidden",
        }}
      >
        <div
          className="bcast-reticle-scan"
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            top: 10,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
            boxShadow: `0 0 12px ${color}`,
            animation: "bcast-reticle-scan 4s ease-in-out infinite",
            willChange: "transform, opacity",
          }}
        />
        <ReticleMarks color={color} />
      </div>

      {/* Point-history trend, top-right of the frame (pushed out to the right).
          Each hung readout is scaled up as a unit (anchored to the corner it
          hangs from) so it reads bigger on air without re-sizing its layout. */}
      {historyPanel ? (
        <div style={{ position: "absolute", ...HISTORY_POS, transform: "scale(1.15)", transformOrigin: "right top" }}>{historyPanel}</div>
      ) : null}

      {/* Event name, lower-centre of the frame. A kind-tinted vector mark (never
          an emoji) sits beside the name; a hairline accent rule + a small-caps
          status line under it give it a designed lower-third feel. Width-capped
          + ellipsised: some sources (e.g. an NWS multi-county areaDesc) can hand
          back a very long title/subtitle, and nowrap-with-no-limit let those run
          off both edges. */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          maxWidth: W - 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          fontFamily: "system-ui, sans-serif",
          textShadow: "0 2px 12px rgba(0,0,0,0.85)",
          // Scrim: the name + location render straight over the basemap, which
          // can be near-white — a soft dark backing keeps the lower-third
          // readable on any map type (and through stream compression).
          padding: "10px 18px 12px",
          borderRadius: 12,
          background: TILE_BG,
          backdropFilter: "var(--panel-blur, blur(5px))",
          WebkitBackdropFilter: "var(--panel-blur, blur(5px))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: "100%" }}>
          <KindGlyph kind={segment.kind} color={color} size={27} />
          <div
            style={{
              fontSize: 28.6,
              fontWeight: 800,
              letterSpacing: 1.5,
              color: "#fff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {name}
          </div>
        </div>
        <div
          style={{
            width: 130,
            height: 2,
            marginTop: 8,
            borderRadius: 2,
            background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          }}
        />
        {segment.subtitle ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 7,
              maxWidth: "100%",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: color,
                boxShadow: `0 0 8px ${color}`,
                flex: "none",
              }}
            />
            <span
              style={{
                fontSize: 13.8,
                fontWeight: 800,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                color: "#dbe7f7",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {segment.subtitle}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The data rows tile into a 2-column grid of stat tiles — label stacked over
 * value, so the value gets the half-cell's full width (side-by-side label+value
 * left almost every real row too long to pair, and the "2 columns" never
 * happened). A row only spans the full card width when its value (or an
 * unusually long label) alone can't fit a half cell — ~24 chars at the value
 * size (e.g. an NWS multi-county REGION string). Shared by the renderer and
 * the height calc so the deck card is sized for the lines that actually render.
 */
const SPAN_CHARS = 24;

function rowSpansBoth(row: { label: string; value: string }): boolean {
  return row.value.length > SPAN_CHARS || row.label.length > SPAN_CHARS;
}

/** Grid lines the rows occupy under auto-placement (a span-2 row that can't
 *  fit beside a half cell wraps to its own line, leaving the hole empty). */
function trackingLines(rows: { label: string; value: string }[]): number {
  let lines = 0;
  let halfFilled = false;
  for (const row of rows) {
    if (rowSpansBoth(row)) {
      lines += 1;
      halfFilled = false;
    } else if (halfFilled) {
      halfFilled = false;
    } else {
      lines += 1;
      halfFilled = true;
    }
  }
  return lines;
}

/**
 * How much taller the deck card gets for an embedded EventTrackingLabel of
 * these data rows — BroadcastFrame adds this to CARD_H when it passes the
 * readout into the deck chrome, so the slide bodies keep their full height
 * under it. (Block padding + eyebrow row + ~35 design px per grid line of
 * stacked tiles; tiles pair two to a line unless one spans both columns.)
 */
export function trackingBlockHeight(rows: { label: string; value: string }[]): number {
  return 36 + 35 * trackingLines(rows);
}

/**
 * The tracking-detail readout — the EVENT DETECTION OVERLAY data rows.
 * BroadcastFrame passes it into the mode deck's chrome (DeckChrome.tracking),
 * so it renders INSIDE the deck card directly under the badge + title bar —
 * part of the card's persistent header, on screen for the whole segment while
 * only the slide bodies rotate beneath. Slimmed for that slot: the title bar
 * right above already carries the kind badge + event name, so this block skips
 * both and keeps just the overlay eyebrow, the [ACTIVE]/[UPCOMING] status tag
 * and the data rows.
 */
export function EventTrackingLabel({
  segment,
  extraDetails = [],
  variant = "event",
  flag,
}: {
  segment: Segment;
  /** Extra rows appended after the segment's own details (e.g. a nearest-city
   *  place line for aircraft/ship, which the segment shape doesn't carry). */
  extraDetails?: { label: string; value: string }[];
  /** "event" (default) reads as a detection lock on a hazard; "place" softens
   *  the wording to NOW VIEWING / LOCATION for a calm Areas-tour city. */
  variant?: "event" | "place";
  /** Flag emoji shown before the LOCATION name (place variant — an Areas tour
   *  parked on a country). */
  flag?: string;
}) {
  const color = KIND_COLOR[segment.kind] ?? "#38bdf8";
  const name = segment.title.toUpperCase();
  const details = [...(segment.details ?? []), ...extraDetails];
  const isPlace = variant === "place";
  // A future-onset alert carries a "Begins in" row (see alertSegmentContent) — it
  // hasn't started, so don't badge it as active.
  const pending = details.some((d) => d.label === "Begins in");
  const statusTag = pending ? "[UPCOMING]" : "[ACTIVE]";
  return (
    <div
      style={{
        // Horizontal padding matches the card template's title bar / body inset,
        // so the rows line up with the rest of the card; the hairline separates
        // the readout from the title bar above without breaking the one-plate look.
        padding: "8px 20px 10px",
        borderTop: DIVIDER,
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      {/* Overlay eyebrow + status tag (the deck header below owns badge + name). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 1.4, color: "#b7c8de" }}>
          ▸ {isPlace ? "NOW VIEWING" : "EVENT DETECTION OVERLAY"}
        </span>
        {!isPlace ? (
          <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color }}>
            {statusTag}
          </span>
        ) : null}
      </div>
      {/* A tour stop names its CITY here (the deck header stays on the area), so
          the place variant keeps a LOCATION row; an event's name would just
          repeat the deck header directly beneath, so it doesn't. The rows tile
          two to a line; a long pair takes the full width (rowSpansBoth). */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14 }}>
        {(isPlace
          ? [{ label: "LOCATION", value: flag ? `${flag} ${name}` : name }, ...details]
          : details
        ).map((d) => (
          <Row
            key={d.label}
            label={d.label.toUpperCase()}
            value={d.value}
            color={color}
            span2={rowSpansBoth(d)}
          />
        ))}
      </div>
    </div>
  );
}

/** One stat tile: micro-label stacked over its value, so the value owns the
 *  cell's full width instead of fighting the label for one line. */
function Row({
  label,
  value,
  color,
  span2,
}: {
  label: string;
  value: string;
  color: string;
  span2?: boolean;
}) {
  const clip: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
  return (
    <div
      style={{
        padding: "3px 0 2px",
        borderTop: "1px solid rgba(120,140,170,0.12)",
        gridColumn: span2 ? "1 / -1" : undefined,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: "#9db1cb", ...clip }}>
        {label}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color, ...clip }}>{value}</div>
    </div>
  );
}

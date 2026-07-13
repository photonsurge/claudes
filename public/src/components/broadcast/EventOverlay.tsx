"use client";

/**
 * The "EVENT DETECTION OVERLAY" reticle: a tilted, corner-bracketed targeting
 * frame around the on-air subject (which the director keeps centred), with the
 * event name as a designed lower-third beneath it — the signature element of the
 * reference broadcast. Colour tracks the segment kind. Pure CSS, inside the
 * scaled design stage.
 *
 * The tracking-detail readout (SEVERITY / TYPE / COUNTRY …) is a separate export
 * (EventTrackingLabel) the frame anchors into the top-left column, rather than
 * floating it off the reticle corner where it collided with the brand block.
 */
import type { Segment } from "@photonsurge/shared/director";
import { STAGE_W, STAGE_H } from "./useStageScale";
import { KIND_COLOR, KIND_LABEL } from "./kinds";
import { accentBorder, DEFAULT_THEME, type BroadcastTheme } from "./config";
import { KindGlyph } from "./glyphs";

const W = 660;
const H = 440;

/**
 * Reticle-bound readout anchors — offsets (design px) from the frame's own edges,
 * so each data panel hangs off the target frame and travels with it rather than
 * pinning to a screen corner. These are the knobs for where the readouts sit:
 *   • LABEL    — tracking detail, tucked onto the top-left corner
 *   • HISTORY  — point-history, top-right, pushed out to the right
 *   • FORECAST — 3-day forecast, on the bottom-right corner
 */
const LABEL_POS = { top: -52, left: -48 };
const HISTORY_POS = { top: -44, right: -150 };
const FORECAST_POS = { bottom: -108, right: -80 };

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
  extraDetails = [],
  historyPanel,
  forecastPanel,
  variant = "event",
  flag,
  theme = DEFAULT_THEME,
}: {
  segment: Segment;
  /** Extra tracking-label rows appended after the segment's own details (e.g. a
   *  nearest-city place line for aircraft/ship). */
  extraDetails?: { label: string; value: string }[];
  /** Point-history trend, hung off the reticle's top-right (HISTORY_POS). */
  historyPanel?: React.ReactNode;
  /** 3-day forecast strip, hung off the reticle's bottom-right (FORECAST_POS). */
  forecastPanel?: React.ReactNode;
  /** "event" (default) reads as a detection lock on a hazard; "place" softens the
   *  wording to NOW VIEWING / LOCATION for a calm Areas-tour city. */
  variant?: "event" | "place";
  /** Flag emoji shown before the LOCATION name (place variant — an Areas tour
   *  parked on a country). */
  flag?: string;
  /** Active broadcast theme — the tracking label draws its glass from the same
   *  tokens as the rest of the on-air cards. */
  theme?: BroadcastTheme;
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
          }}
        />
        <ReticleMarks color={color} />
      </div>

      {/* Tracking-detail readout, hung onto the reticle's top-left corner. */}
      <div style={{ position: "absolute", ...LABEL_POS }}>
        <EventTrackingLabel segment={segment} extraDetails={extraDetails} variant={variant} flag={flag} theme={theme} />
      </div>

      {/* Point-history trend, top-right of the frame (pushed out to the right). */}
      {historyPanel ? (
        <div style={{ position: "absolute", ...HISTORY_POS }}>{historyPanel}</div>
      ) : null}

      {/* 3-day forecast, bottom-right of the frame. */}
      {forecastPanel ? (
        <div style={{ position: "absolute", ...FORECAST_POS }}>{forecastPanel}</div>
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
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: "100%" }}>
          <KindGlyph kind={segment.kind} color={color} size={24} />
          <div
            style={{
              fontSize: 23,
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
                fontSize: 11,
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
 * The tracking-detail readout (kind badge + EVENT DETECTION OVERLAY header +
 * the segment's detail rows). Rendered as a self-contained glass panel with no
 * positioning of its own — the frame anchors it into the top-left column so it
 * sits cleanly under the brand block instead of over the reticle/clocks.
 */
function EventTrackingLabel({
  segment,
  extraDetails = [],
  variant = "event",
  flag,
  theme = DEFAULT_THEME,
}: {
  segment: Segment;
  /** Extra rows appended after the segment's own details (e.g. a nearest-city
   *  place line for aircraft/ship, which the segment shape doesn't carry). */
  extraDetails?: { label: string; value: string }[];
  variant?: "event" | "place";
  flag?: string;
  theme?: BroadcastTheme;
}) {
  const color = KIND_COLOR[segment.kind] ?? "#38bdf8";
  const kindLabel = KIND_LABEL[segment.kind] ?? segment.kind;
  const name = segment.title.toUpperCase();
  const details = [...(segment.details ?? []), ...extraDetails];
  const isPlace = variant === "place";
  const locationValue = isPlace && flag ? `${flag} ${name}` : isPlace ? name : `${name} [ACTIVE]`;
  return (
    <div
      style={{
        minWidth: 250,
        padding: "10px 14px",
        background: theme.panelBg,
        ...accentBorder(theme.panelBorder, `3px solid ${color}`),
        borderRadius: 10,
        boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "none",
      }}
    >
      {/* Kind badge + overlay header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            padding: "2px 6px",
            borderRadius: 4,
            background: color,
            color: "#fff",
          }}
        >
          {kindLabel}
        </span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, color: "#9fb3cc" }}>
          ▸ {isPlace ? "NOW VIEWING" : "EVENT DETECTION OVERLAY"}
        </span>
      </div>
      <Row label={isPlace ? "LOCATION" : "EVENT TRACKING"} value={locationValue} color={color} />
      {details.map((d) => (
        <Row key={d.label} label={d.label.toUpperCase()} value={d.value} color={color} />
      ))}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "baseline",
        fontSize: 12,
        padding: "2px 0",
        borderTop: "1px solid rgba(120,140,170,0.12)",
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, color: "#8ea3bf", minWidth: 92 }}>
        {label}
      </span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  );
}

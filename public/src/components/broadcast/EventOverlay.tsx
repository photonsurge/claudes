"use client";

/**
 * The "EVENT DETECTION OVERLAY" reticle: a tilted, corner-bracketed frame around
 * the on-air subject (which the director keeps centred), with a tracking label
 * panel + the event name — the signature element of the reference broadcast.
 *
 * It mirrors the ACTUAL on-air segment (the same thing the "now viewing" card
 * shows), so the reticle label always matches what's selected — an earthquake
 * reads "EARTHQUAKE · M4.4", not a generic "ACTIVE EVENT". Colour tracks the
 * segment kind. Pure CSS, inside the scaled design stage.
 */
import type { Segment } from "@photonsurge/shared/director";
import { STAGE_W, STAGE_H } from "./useStageScale";
import { KIND_COLOR, KIND_LABEL } from "./kinds";

const W = 660;
const H = 440;

function Bracket({ corner, color }: { corner: "tl" | "tr" | "bl" | "br"; color: string }) {
  const bt = corner[0] === "t";
  const bl = corner[1] === "l";
  return (
    <div
      style={{
        position: "absolute",
        ...(bt ? { top: -1 } : { bottom: -1 }),
        ...(bl ? { left: -1 } : { right: -1 }),
        width: 34,
        height: 34,
        borderTop: bt ? `2px solid ${color}` : undefined,
        borderBottom: !bt ? `2px solid ${color}` : undefined,
        borderLeft: bl ? `2px solid ${color}` : undefined,
        borderRight: !bl ? `2px solid ${color}` : undefined,
        boxShadow: `0 0 8px ${color}66`,
      }}
    />
  );
}

export default function EventOverlay({
  segment,
  extraDetails = [],
  historyPanel,
}: {
  segment: Segment;
  /** Extra rows appended after the segment's own details (e.g. a nearest-city
   *  place line for aircraft/ship, which the segment shape doesn't carry). */
  extraDetails?: { label: string; value: string }[];
  /** A compact PointHistoryPanel for this event's focus, tucked into the
   *  reticle's top-right (mirrors the tracking label's top-left slot) instead
   *  of competing for space in the bottom-left column. */
  historyPanel?: React.ReactNode;
}) {
  const color = KIND_COLOR[segment.kind] ?? "#38bdf8";
  const kindLabel = KIND_LABEL[segment.kind] ?? segment.kind;
  const name = segment.title.toUpperCase();
  // The full detail set from the segment (Magnitude, Depth, Occurred, …) — the
  // same rows the old bottom-left card showed, now folded into the reticle.
  const details = [...(segment.details ?? []), ...extraDetails];

  const left = (STAGE_W - W) / 2;
  const top0 = (STAGE_H - H) / 2 - 40;

  return (
    <div style={{ position: "absolute", left, top: top0, width: W, height: H, pointerEvents: "none" }}>
      {/* Tilted reticle frame. */}
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
        }}
      >
        <Bracket corner="tl" color={color} />
        <Bracket corner="tr" color={color} />
        <Bracket corner="bl" color={color} />
        <Bracket corner="br" color={color} />
      </div>

      {/* Tracking label panel, top-left of the frame — carries the on-air detail. */}
      <div
        style={{
          position: "absolute",
          top: -48,
          left: -54,
          minWidth: 250,
          padding: "9px 13px",
          background: "rgba(8,13,22,0.78)",
          border: `1px solid ${color}44`,
          borderLeft: `3px solid ${color}`,
          borderRadius: 6,
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          fontFamily: "system-ui, sans-serif",
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
            ▸ EVENT DETECTION OVERLAY
          </span>
        </div>
        <Row label="EVENT TRACKING" value={`${name} [ACTIVE]`} color={color} />
        {details.map((d) => (
          <Row key={d.label} label={d.label.toUpperCase()} value={d.value} color={color} />
        ))}
      </div>

      {/* History panel, top-right of the frame — mirrors the tracking label's
          top-left slot so the reticle carries its own trend context instead of
          the bottom-left column. */}
      {historyPanel ? (
        <div style={{ position: "absolute", top: -48, right: -54 }}>{historyPanel}</div>
      ) : null}

      {/* Event name, lower-centre of the frame. Width-capped + ellipsised: some
          sources (e.g. an NWS multi-county areaDesc) can hand back a very long
          subtitle, and nowrap-with-no-limit let that run off both edges. */}
      <div
        style={{
          position: "absolute",
          bottom: 26,
          left: "50%",
          transform: "translateX(-50%)",
          maxWidth: W - 40,
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
          textShadow: "0 2px 10px rgba(0,0,0,0.8)",
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: 2,
            color: "#fff",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {segment.icon ? `${segment.icon} ` : ""}
          {name}
        </div>
        {segment.subtitle ? (
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: 0.5,
              color: "#cfe0f5",
              opacity: 0.85,
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {segment.subtitle}
          </div>
        ) : null}
      </div>
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

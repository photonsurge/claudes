"use client";

/**
 * Minimal on-air caption for the auto-director (a placeholder lower-third — the
 * proper broadcast graphics land in a later phase). Shows the current shot's
 * title/subtitle and a small "up next" hint. Non-interactive so it never eats
 * pointer events on the captured /watch surface.
 */
import type { Segment, SegmentKind } from "@photonsurge/shared/director";

const KIND_LABEL: Record<SegmentKind, string> = {
  intro: "Live",
  ocean: "Ocean",
  orbital: "Orbital",
  tour: "Region",
  country: "Country",
  weather: "Weather",
  storm: "Severe",
  quake: "Seismic",
  flight: "Aircraft",
  ship: "Vessel",
  ad: "Sponsor",
  summary: "Round-Up",
};

export default function DirectorCaption({
  segment,
  upNext,
}: {
  segment: Segment;
  upNext: { kind: SegmentKind; title: string }[];
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 24,
        bottom: 56,
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        color: "#fff",
        textShadow: "0 1px 3px rgba(0,0,0,0.9)",
        maxWidth: "60vw",
      }}
    >
      <div
        style={{
          display: "inline-block",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1,
          textTransform: "uppercase",
          padding: "3px 8px",
          borderRadius: 3,
          background: "rgba(220,40,40,0.92)",
          marginBottom: 8,
        }}
      >
        {KIND_LABEL[segment.kind] ?? segment.kind}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1 }}>{segment.title}</div>
      {segment.subtitle ? (
        <div style={{ fontSize: 16, opacity: 0.92, marginTop: 2 }}>{segment.subtitle}</div>
      ) : null}
      {upNext.length ? (
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10, letterSpacing: 0.5 }}>
          UP NEXT · {upNext.map((u) => u.title).join("  ·  ")}
        </div>
      ) : null}
    </div>
  );
}

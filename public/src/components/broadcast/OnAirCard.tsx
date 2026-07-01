"use client";

/**
 * Compact on-air card for WIDE shots (global intro, ocean, orbital, region tour,
 * weather) — the ones with no single point to frame, so the centred event
 * reticle would just box empty screen. Tucked lower-left, themed + scaled inside
 * the design stage. Shows the kind badge, title/subtitle and a couple of detail
 * rows — the same info the old free-floating "now viewing" card carried.
 */
import type { Segment } from "@photonsurge/shared/director";
import type { AlertFeature } from "../../lib/alerts";
import type { Quake } from "../../lib/tracks/types";
import { alertSummary } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { KIND_COLOR, KIND_LABEL } from "./kinds";
import AreaStatus from "./AreaStatus";

export default function OnAirCard({
  segment,
  alerts = [],
  quakes = [],
  theme = DEFAULT_THEME,
}: {
  segment: Segment;
  alerts?: AlertFeature[];
  quakes?: Quake[];
  theme?: BroadcastTheme;
}) {
  const color = KIND_COLOR[segment.kind] ?? theme.accent;
  const kindLabel = KIND_LABEL[segment.kind] ?? segment.kind;
  const details = (segment.details ?? []).slice(0, 3);
  const summary = alertSummary(alerts, quakes);

  return (
    <div
      style={{
        width: 320,
        padding: "11px 14px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderLeft: `3px solid ${color}`,
        borderRadius: 12,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        color: "#e6edf7",
      }}
    >
      <style>{"@keyframes bcast-onair{0%,100%{opacity:1}50%{opacity:0.4}}"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            padding: "2px 7px",
            borderRadius: 4,
            background: color,
            color: "#fff",
          }}
        >
          {kindLabel}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc" }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#ff3b3b",
              animation: "bcast-onair 1.4s ease-in-out infinite",
            }}
          />
          ON AIR
        </span>
      </div>

      <div style={{ fontSize: 21, fontWeight: 800, lineHeight: 1.1 }}>
        {segment.icon ? `${segment.icon} ` : ""}
        {segment.title}
      </div>
      {segment.subtitle ? (
        <div style={{ fontSize: 12.5, opacity: 0.82, marginTop: 3 }}>{segment.subtitle}</div>
      ) : null}

      {details.length ? (
        <div
          style={{
            marginTop: 10,
            paddingTop: 9,
            borderTop: "1px solid rgba(120,140,170,0.15)",
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            rowGap: 3,
            columnGap: 12,
            fontSize: 12,
          }}
        >
          {details.map((d) => (
            <div key={d.label} style={{ display: "contents" }}>
              <span style={{ opacity: 0.55, fontWeight: 700, letterSpacing: 0.3 }}>{d.label}</span>
              <span style={{ fontWeight: 700, textAlign: "right" }}>{d.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* On a wide/area shot, roll up everything on screen into a count + type
          breakdown so a busy region reads at a glance. */}
      {summary.total || summary.quakeCount ? <AreaStatus summary={summary} /> : null}
    </div>
  );
}

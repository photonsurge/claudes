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
        width: 460,
        padding: "16px 20px",
        background: theme.panelBg,
        border: theme.panelBorder,
        borderLeft: `4px solid ${color}`,
        borderRadius: 14,
        boxShadow: "0 8px 26px rgba(0,0,0,0.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        pointerEvents: "none",
        fontFamily: "system-ui, sans-serif",
        color: "#e6edf7",
      }}
    >
      <style>{"@keyframes bcast-onair{0%,100%{opacity:1}50%{opacity:0.4}}"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: "uppercase",
            padding: "3px 10px",
            borderRadius: 5,
            background: color,
            color: "#fff",
          }}
        >
          {kindLabel}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc" }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "#ff3b3b",
              animation: "bcast-onair 1.4s ease-in-out infinite",
            }}
          />
          ON AIR
        </span>
      </div>

      <div
        style={{
          fontSize: 30,
          fontWeight: 800,
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {segment.icon ? `${segment.icon} ` : ""}
        {segment.title}
      </div>
      {segment.subtitle ? (
        <div
          style={{
            fontSize: 17,
            opacity: 0.82,
            marginTop: 4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {segment.subtitle}
        </div>
      ) : null}

      {details.length ? (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid rgba(120,140,170,0.15)",
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            rowGap: 5,
            columnGap: 16,
            fontSize: 16,
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

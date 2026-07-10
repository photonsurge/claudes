"use client";

/**
 * Compact on-air card for WIDE shots (global intro, ocean, orbital, region tour,
 * weather) — the ones with no single point to frame, so the centred event
 * reticle would just box empty screen. Tucked lower-left, themed + scaled inside
 * the design stage. Shows the kind badge, title/subtitle and a couple of detail
 * rows — the same info the old free-floating "now viewing" card carried.
 */
import type { Segment } from "@photonsurge/shared/director";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { AlertFeature } from "../../lib/alerts";
import type { Quake } from "../../lib/tracks/types";
import { alertSummary } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection, DIM } from "./BroadcastCard";
import { KIND_COLOR, KIND_LABEL } from "./kinds";
import AreaStatus from "./AreaStatus";
import type { AreaInfo } from "./mode-slides";

export default function OnAirCard({
  segment,
  alerts = [],
  quakes = [],
  volcanoes = [],
  areaInfo = null,
  theme = DEFAULT_THEME,
}: {
  segment: Segment;
  alerts?: AlertFeature[];
  quakes?: Quake[];
  volcanoes?: Volcano[];
  /** "Where we are" — enriched photo + blurb for the on-air area, shown as the
   *  uniform lede's area block. Null over ocean / before enrichment. */
  areaInfo?: AreaInfo | null;
  theme?: BroadcastTheme;
}) {
  const color = KIND_COLOR[segment.kind] ?? theme.accent;
  const kindLabel = KIND_LABEL[segment.kind] ?? segment.kind;
  const details = (segment.details ?? []).slice(0, 3);
  const summary = alertSummary(alerts, quakes, volcanoes);
  const hasArea = areaInfo != null && (areaInfo.photo != null || areaInfo.blurb != null);

  return (
    <BroadcastCard accent={color} badge={kindLabel} badgeColor={color} live theme={theme}>
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

      {/* "Where we are" — a compact area teaser (photo + short blurb) from the
          enriched Country catalog, so every mode's first slide carries the same
          sense of place. A fuller CountryPanel hero may follow later in the deck
          (summary/round-up); this is the at-a-glance version. */}
      {hasArea ? (
        <CardSection eyebrow="The Area" style={{ marginTop: 14 }}>
          {areaInfo!.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={areaInfo!.photo}
              alt={areaInfo!.name}
              style={{ width: "100%", height: 118, objectFit: "cover", borderRadius: 7, display: "block", marginBottom: 8 }}
            />
          ) : null}
          <div style={{ fontSize: 14, fontWeight: 800, color: "#e6eefb", lineHeight: 1.15 }}>{areaInfo!.name}</div>
          {areaInfo!.blurb ? (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.45,
                color: DIM,
                marginTop: 4,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {areaInfo!.blurb}
            </div>
          ) : null}
        </CardSection>
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
          breakdown so a busy region reads at a glance. For a country/region
          spotlight with nothing active, say so rather than leaving a silent gap. */}
      {summary.total || summary.quakeCount || summary.volcanoCount ? (
        <AreaStatus summary={summary} />
      ) : segment.kind === "country" || segment.kind === "tour" ? (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(120,140,170,0.18)" }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: "#7f8ea6" }}>
            NO ACTIVE ALERTS
          </span>
        </div>
      ) : null}
    </BroadcastCard>
  );
}

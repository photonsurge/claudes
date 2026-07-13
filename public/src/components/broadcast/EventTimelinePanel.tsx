"use client";

/**
 * "TIMELINE" — the on-air event's UNIFIED cross-source change log: the promoted
 * alert changes PLUS every external contribution (deep-GDACS impact, Copernicus
 * mapping products, EONET geometry/closure…), each tagged with its source. The
 * superset of the alert timeline; the storm deck prefers this whenever the alert
 * was promoted to a WatchedEvent, falling back to AlertTimelinePanel otherwise.
 * Pure presentation, pointer-inert — mirrors AlertTimelinePanel's shell.
 */
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";
import { latestEventBeats } from "@photonsurge/shared/events/event-timeline";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import { severityColor, severityLabel } from "../../lib/alerts";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection, DIM } from "./BroadcastCard";

const ROWS = 6;

const GLYPH: Record<string, string> = {
  ISSUED: "🟢",
  SOURCE_LINKED: "🔗",
  SEVERITY_CHANGED: "⚠️",
  AREA_CHANGED: "📐",
  TEXT_CHANGED: "📝",
  INSTRUCTION_CHANGED: "📋",
  START_TIME_CHANGED: "🕒",
  EXPIRY_CHANGED: "⏳",
  IMPACT_UPDATE: "📊",
  PRODUCT_ADDED: "🗺️",
  MAP_ADDED: "🗺️",
  IMAGE_ADDED: "🖼️",
  REPORT_ADDED: "📰",
  GEOMETRY_REFINED: "✏️",
  SNAPSHOT_CAPTURED: "🛰️",
  CANCELLED: "🚫",
  ENDED: "⚫",
  CLOSED: "⚫",
  UPDATED: "🔄",
};

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 16);
};

/** Whether the timeline earns a slide (more than a lone opening beat). */
export function eventTimelineSlideHasContent(beats: EventTimelineBeat[] | undefined): boolean {
  return !!beats && beats.length > 1;
}

function BeatRow({ beat }: { beat: EventTimelineBeat }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "5px 0" }}>
      <span style={{ flex: "0 0 auto", width: 42, color: DIM, fontVariantNumeric: "tabular-nums" }}>{hhmm(beat.at)}</span>
      <span aria-hidden style={{ flex: "0 0 auto", width: 18, textAlign: "center" }}>
        {GLYPH[beat.type] ?? "•"}
      </span>
      <div style={{ minWidth: 0, flex: 1, color: "#e6eefb", fontWeight: 600 }}>
        {beat.label}
        {typeof beat.severityRank === "number" ? (
          <span style={{ marginLeft: 6, fontWeight: 700, color: severityColor(beat.severityRank as SeverityRank) }}>
            · {severityLabel(beat.severityRank as SeverityRank)}
          </span>
        ) : null}
      </div>
      {beat.source ? (
        <span style={{ flex: "0 0 auto", color: DIM, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {beat.source}
        </span>
      ) : null}
    </div>
  );
}

export default function EventTimelinePanel({
  beats,
  color = "#d23a3a",
  theme = DEFAULT_THEME,
}: {
  beats: EventTimelineBeat[];
  color?: string;
  theme?: BroadcastTheme;
}) {
  if (!eventTimelineSlideHasContent(beats)) return null;
  const shown = latestEventBeats(beats, ROWS);
  const hidden = beats.length - shown.length;

  return (
    <BroadcastCard accent={color} eyebrow="Timeline" theme={theme}>
      <CardSection first style={{ fontSize: 13 }}>
        {hidden > 0 ? <div style={{ color: DIM, fontWeight: 700, marginBottom: 4 }}>+{hidden} earlier</div> : null}
        {shown.map((b, i) => (
          <BeatRow key={`${b.at}-${b.type}-${i}`} beat={b} />
        ))}
      </CardSection>
    </BroadcastCard>
  );
}

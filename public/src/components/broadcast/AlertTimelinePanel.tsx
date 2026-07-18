"use client";

/**
 * "TIMELINE" — the on-air storm's live change log: ISSUED → severity/area/expiry
 * changes → ENDED, derived (shared buildTimeline) from the alert's in-place
 * revisions + CAP chain and delivered on the focus bundle. One slide in the storm
 * deck; self-hides when there's nothing beyond the initial bulletin. Pure
 * presentation, pointer-inert — mirrors AreaAlertsPanel's shell + row shape.
 */
import type { AlertTimelineBeat } from "@photonsurge/shared/alerts/timeline";
import { latestBeats } from "@photonsurge/shared/alerts/timeline";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import { severityColor, severityLabel } from "../../lib/alerts";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection, DIM } from "./BroadcastCard";

/** Latest N beats to show — a slide-height affordance, not a data cap. */
const ROWS = 6;

const GLYPH: Record<string, string> = {
  ISSUED: "🟢",
  SEVERITY_CHANGED: "⚠️",
  AREA_CHANGED: "📐",
  TEXT_CHANGED: "📝",
  INSTRUCTION_CHANGED: "📋",
  START_TIME_CHANGED: "🕒",
  EXPIRY_CHANGED: "⏳",
  CANCELLED: "🚫",
  ENDED: "⚫",
  UPDATED: "🔄",
};

const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 16);
};

/** Whether the timeline earns a slide (more than a lone ISSUED beat). */
export function alertTimelineSlideHasContent(beats: AlertTimelineBeat[] | undefined): boolean {
  return !!beats && beats.length > 1;
}

function BeatRow({ beat }: { beat: AlertTimelineBeat }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "5px 0" }}>
      <span style={{ flex: "0 0 auto", width: 42, color: DIM, fontVariantNumeric: "tabular-nums" }}>
        {hhmm(beat.at)}
      </span>
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
    </div>
  );
}

export default function AlertTimelinePanel({
  beats,
  color = "#d23a3a",
  theme = DEFAULT_THEME,
}: {
  beats: AlertTimelineBeat[];
  color?: string;
  theme?: BroadcastTheme;
}) {
  if (!alertTimelineSlideHasContent(beats)) return null;
  const shown = latestBeats(beats, ROWS);
  const hidden = beats.length - shown.length;

  return (
    <BroadcastCard accent={color} eyebrow="Timeline" theme={theme}>
      <CardSection first style={{ fontSize: 14.3 }}>
        {hidden > 0 ? <div style={{ color: DIM, fontWeight: 700, marginBottom: 4 }}>+{hidden} earlier</div> : null}
        {shown.map((b, i) => (
          <BeatRow key={`${b.at}-${b.type}-${i}`} beat={b} />
        ))}
      </CardSection>
    </BroadcastCard>
  );
}

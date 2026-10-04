"use client";

/**
 * The deck page a GROUPED break-in leads with: every event the burst cut
 * covers ("4 NEW SEVERE WARNINGS" → each area and warning), so one shot names
 * all of them instead of four cuts in a row. Pure presentation inside the
 * scaled broadcast stage; pointer-inert.
 */
import type { Segment } from "@photonsurge/shared/director";
import BroadcastCard, { CardSection } from "./BroadcastCard";
import type { BroadcastTheme } from "./config";

/** Most rows the card lists; the rest are counted. */
export const MAX_BREAK_IN_ROWS = 8;

export default function BreakInItemsPanel({
  segment,
  color,
  theme,
}: {
  segment: Segment;
  color: string;
  theme?: BroadcastTheme;
}) {
  const items = segment.breakIn?.items ?? [];
  if (items.length < 2) return null;
  const shown = items.slice(0, MAX_BREAK_IN_ROWS);
  const more = items.length - shown.length;
  return (
    <BroadcastCard accent={color} eyebrow="⚡ BREAKING" eyebrowColor={color} theme={theme}>
      <CardSection first eyebrow={segment.title}>
        {shown.map((item) => (
          <div key={item.segmentId} style={{ padding: "3px 0" }}>
            <div style={{ fontWeight: 700, color: "#e6eefb" }}>{item.title}</div>
            {item.subtitle ? <div style={{ color: "#8ea3bf" }}>{item.subtitle}</div> : null}
          </div>
        ))}
        {more > 0 ? <div style={{ color: "#8ea3bf", paddingTop: 3 }}>and {more} more</div> : null}
      </CardSection>
    </BroadcastCard>
  );
}

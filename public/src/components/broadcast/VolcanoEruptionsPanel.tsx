"use client";

/**
 * On-air card for a volcano's ERUPTION HISTORY — Band 2 of the per-volcano
 * timeline (docs/volcano-observation-plan.md §7.12).
 *
 * Deliberately a separate band from the observation timeline: camera frames span
 * DAYS, eruption history spans CENTURIES, and one linear axis would render either
 * the recent detail or the deep history invisible.
 *
 * A CATALOG fact — present for every volcano, dormant or not, promoted or not — so
 * it rides the focus call via `FocusBundle.volcanoEruptions` with no fetch. Dates
 * are fuzzy by nature (GVP years reach 55,500 BCE; month/day are often unknown), so
 * they're rendered with `formatGvpDate` rather than pretending to a precision GVP
 * never claimed.
 */
import type { VolcanoEruption } from "@photonsurge/shared/db/volcano-eruption-repo";
import { formatGvpDate } from "@photonsurge/shared/volcanoes/gvp-wfs";
import BroadcastCard, { CardSection } from "./BroadcastCard";

const MAX_ROWS = 6;

/** VEI 0-7 → a green→red ramp, matching the admin dossier. */
const VEI_COLOR = ["#64748b", "#34d399", "#a3e635", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#b91c1c"];

const startLabel = (e: VolcanoEruption): string =>
  formatGvpDate({
    year: e.startYear,
    month: e.startMonth,
    day: e.startDay,
    precision: e.startPrecision ?? "year",
    modifier: e.startModifier,
  });

export function volcanoEruptionsSlideHasContent(eruptions: VolcanoEruption[]): boolean {
  return eruptions.length > 0;
}

export default function VolcanoEruptionsPanel({
  eruptions,
  color = "#ef4444",
}: {
  eruptions: VolcanoEruption[];
  color?: string;
}) {
  if (!eruptions.length) return null;

  const shown = eruptions.slice(0, MAX_ROWS); // repo returns newest first
  const withVei = eruptions.filter((e) => e.vei !== undefined);
  const largest = withVei.length ? Math.max(...withVei.map((e) => e.vei!)) : undefined;
  const since1900 = eruptions.filter((e) => e.startYear >= 1900).length;
  const oldest = eruptions[eruptions.length - 1];

  return (
    <BroadcastCard accent={color} eyebrow="Eruption history">
      <CardSection
        first
        eyebrow={`${eruptions.length} recorded · ${since1900} since 1900${largest !== undefined ? ` · max VEI ${largest}` : ""}`}
      >
        {shown.map((e) => (
          <div
            key={e.eruptionNumber}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13.2 }}
          >
            <span style={{ color: "#e2e8f0", minWidth: 92, fontVariantNumeric: "tabular-nums" }}>{startLabel(e)}</span>
            {e.vei !== undefined ? (
              <>
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: Math.max(5, (e.vei + 1) * 6),
                    height: 7,
                    borderRadius: 2,
                    background: VEI_COLOR[e.vei] ?? "#64748b",
                  }}
                />
                <span style={{ color: "#8ea3bf" }}>VEI {e.vei}</span>
              </>
            ) : (
              <span style={{ color: "#5b6478" }}>—</span>
            )}
            {!e.confirmed && <span style={{ color: "#5b6478", fontSize: 11 }}>uncertain</span>}
          </div>
        ))}
        {oldest && eruptions.length > MAX_ROWS && (
          <div style={{ color: "#5b6478", fontSize: 11, marginTop: 4 }}>
            earliest recorded {startLabel(oldest)}
          </div>
        )}
      </CardSection>
    </BroadcastCard>
  );
}

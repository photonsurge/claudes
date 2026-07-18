"use client";

/**
 * "ACTIVE ALERTS" — the round-up's country-scoped warnings slide: the actual
 * live alerts inside the country the tour is parked on (not just a tally — that
 * lives on OnAirCard's IN VIEW rollup). Alerts are de-duped by area + hazard
 * (same rule as `alertSummary`, so the same town in four languages counts once)
 * and severity-sorted, most severe first. Self-hides when the country has no
 * active alerts (caller drops the slide). Pure presentation, pointer-inert.
 */
import type { AlertFeature } from "../../lib/alerts";
import { severityColor, severityLabel, formatPeople } from "../../lib/alerts";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection, DIM } from "./BroadcastCard";

/** How many alert rows to list before rolling the remainder into a "+N more"
 *  line — a slide-height affordance (the stage is 1080px), not a data cap. */
const ROWS = 6;

/** Distinct alerts by area + hazard, keeping the most severe of each, severity-first. */
function distinctAlerts(alerts: AlertFeature[]): AlertFeature[] {
  const seen = new Map<string, AlertFeature>();
  for (const a of alerts) {
    const p = a.properties;
    const key = `${(p.areaDesc || p.headline || p.event || p.id).toLowerCase().trim()}|${p.hazard}`;
    const cur = seen.get(key);
    if (!cur || p.severityRank > cur.properties.severityRank) seen.set(key, a);
  }
  return [...seen.values()].sort((a, b) => b.properties.severityRank - a.properties.severityRank);
}

function AlertRow({ alert }: { alert: AlertFeature }) {
  const p = alert.properties;
  const color = severityColor(p.severityRank);
  const label = p.translatedHeadline || p.headline || p.event;
  // Cities-based estimate of people under this specific warning's footprint —
  // "~1.2M people". Absent for a geocode-only alert (no shape to count).
  const people = formatPeople(p.population);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "5px 0" }}>
      <span style={{ flex: "0 0 auto", width: 9, height: 9, borderRadius: 3, background: color, marginTop: 5 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontWeight: 700,
            color: "#e6eefb",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>
        <div style={{ color: DIM, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {[severityLabel(p.severityRank), p.areaDesc, people && `~${people} people`]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
    </div>
  );
}

export default function AreaAlertsPanel({
  alerts,
  color = "#8a5fd1",
  theme = DEFAULT_THEME,
}: {
  alerts: AlertFeature[];
  color?: string;
  theme?: BroadcastTheme;
}) {
  const distinct = distinctAlerts(alerts);
  if (!distinct.length) return null;

  const shown = distinct.slice(0, ROWS);
  const extra = distinct.length - shown.length;

  // Rough people-under-warnings total across the distinct areas — deduped by
  // area+hazard above, so a warning reported in four languages is counted once.
  // Distinct AREAS are disjoint counties, so summing them doesn't double-count.
  const totalPeople = formatPeople(distinct.reduce((n, a) => n + (a.properties.population ?? 0), 0));

  return (
    <BroadcastCard
      accent={color}
      eyebrow="Active Alerts"
      headerRight={
        <span style={{ fontSize: 22, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
          {distinct.length}
        </span>
      }
      theme={theme}
    >
      <CardSection first style={{ fontSize: 14.3 }}>
        {shown.map((a) => (
          <AlertRow key={a.properties.id + a.properties.areaDesc} alert={a} />
        ))}
        {extra > 0 ? (
          <div style={{ color: DIM, fontWeight: 700, marginTop: 6 }}>+{extra} more</div>
        ) : null}
        {totalPeople ? (
          <div style={{ color: DIM, marginTop: 8, fontSize: 12.5 }}>
            ≈ {totalPeople} people in affected areas
          </div>
        ) : null}
      </CardSection>
    </BroadcastCard>
  );
}

export { distinctAlerts };

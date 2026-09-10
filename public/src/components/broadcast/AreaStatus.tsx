"use client";

/**
 * The situation summary shown on a wide/area shot: how many hazards are on
 * screen, how severe, and of what types. A severity strip (Extreme → Minor) up
 * top for the "how much red" read at a glance, then a hazard-type breakdown with
 * icons + counts. Pure presentation off a precomputed AreaSummary.
 */
import type { AreaSummary } from "../../lib/broadcast";
import type { HazardType } from "../../lib/hazard";
import { HazardGlyph } from "./glyphs";

/** One area's tally for the by-area breakdown — a continent on a world spin, so
 *  the whole-globe rollup reads "which parts of the planet are lit up" instead of
 *  one flat, meaningless "N alerts in view". */
export interface AreaBreakdown {
  name: string;
  count: number;
  /** This area's severity mix — proportional mini-bar, most severe first. */
  bySeverity: { rank: number; color: string; count: number }[];
}

export default function AreaStatus({
  summary,
  label = "IN VIEW",
  byArea,
  activeHazard = null,
}: {
  summary: AreaSummary;
  /** The hazard type the globe is lighting right now (see lib/alert-cycle). Its
   *  row steps forward while the others recede, so the breakdown reads as a
   *  caption for what the map is currently showing rather than a static tally.
   *  Null when the cycle is off/inert — every row then reads equally, as before. */
  activeHazard?: HazardType | null;
  /** Eyebrow over the count — "IN VIEW" for a framed area (country/region/global),
   *  "NEARBY" for a single tracked event whose rollup is a great-circle radius,
   *  "WORLDWIDE" for a whole-globe spin (paired with `byArea`). */
  label?: string;
  /** Present only on a whole-globe spin: the alert count broken down by continent.
   *  When set, the per-area rows replace the (redundant) hazard-type breakdown —
   *  each area's own severity mini-bar already reads the "how much red" at a glance. */
  byArea?: AreaBreakdown[];
}) {
  const { total, quakeCount, volcanoCount, bySeverity, byHazard } = summary;
  // Lead with whatever is actually present rather than a hard-coded "N alerts",
  // which read a jarring "0 alerts" on a volcano/quake shot (where alerts are the
  // sideshow, not the subject). Fixed precedence: alerts → seismic → volcanic; the
  // first non-zero becomes the big headline number, the rest trail as chips.
  const parts: { count: number; noun: string; color: string }[] = [];
  if (total) parts.push({ count: total, noun: `alert${total === 1 ? "" : "s"}`, color: "#fff" });
  if (quakeCount) parts.push({ count: quakeCount, noun: "seismic", color: "#e08a1e" });
  if (volcanoCount) parts.push({ count: volcanoCount, noun: "volcanic", color: "#ef4444" });
  const [lead, ...rest] = parts;
  // Caller only renders this when something is present, so `lead` is always set;
  // guard anyway rather than assume.
  if (!lead) return null;
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(120,140,170,0.18)" }}>
      {/* Headline counts */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 11 }}>
        <span style={{ fontSize: 13.2, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc" }}>
          {label}
        </span>
        <span style={{ fontSize: 30.8, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
          {lead.count}
        </span>
        <span style={{ fontSize: 16.5, fontWeight: 700, color: lead.color === "#fff" ? "#9fb3cc" : lead.color }}>
          {lead.noun}
        </span>
        {rest.map((p) => (
          <span key={p.noun} style={{ fontSize: 16.5, fontWeight: 700, color: p.color }}>
            · {p.count} {p.noun}
          </span>
        ))}
      </div>

      {/* Severity strip — proportional bar + labelled counts. */}
      {bySeverity.length ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", height: 11, borderRadius: 5, overflow: "hidden", gap: 1 }}>
            {bySeverity.map((s) => (
              <div
                key={s.rank}
                title={`${s.label}: ${s.count}`}
                style={{ flex: s.count, background: s.color, minWidth: 4 }}
              />
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 14px", marginTop: 9 }}>
            {bySeverity.map((s) => (
              <span
                key={s.rank}
                style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 16.5, fontWeight: 700 }}
              >
                <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color }} />
                <span style={{ fontVariantNumeric: "tabular-nums", color: "#fff" }}>{s.count}</span>
                <span style={{ color: "#9fb3cc", fontWeight: 600 }}>{s.label}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* By-area breakdown (world spins) — one row per continent, busiest first,
          with a proportional severity mini-bar. Shown INSTEAD of the hazard-type
          breakdown: on a whole-globe shot "where" beats "what". */}
      {byArea && byArea.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {byArea.map((a) => {
            const barTotal = a.bySeverity.reduce((n, s) => n + s.count, 0) || 1;
            return (
              <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 96,
                    flex: "none",
                    fontSize: 15.4,
                    fontWeight: 700,
                    color: "#dfe7f5",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {a.name}
                </span>
                <span
                  style={{
                    width: 34,
                    flex: "none",
                    textAlign: "right",
                    fontSize: 16.5,
                    fontWeight: 800,
                    color: "#fff",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {a.count}
                </span>
                <div style={{ display: "flex", flex: 1, height: 9, borderRadius: 4, overflow: "hidden", gap: 1 }}>
                  {a.bySeverity.map((s) => (
                    <div key={s.rank} style={{ flex: s.count / barTotal, background: s.color, minWidth: 3 }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Hazard-type breakdown — top types with icon + count. */}
      {!byArea && byHazard.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 14px" }}>
          {byHazard.slice(0, 8).map((h) => {
            // Follow the globe's hazard cycle: the type lit on the map right now
            // stands up (its own colour, a soft glow), the rest recede.
            const on = activeHazard != null && h.hazard === activeHazard;
            const off = activeHazard != null && !on;
            return (
              <span
                key={h.hazard}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontSize: 17.1,
                  fontWeight: 700,
                  color: on ? "#fff" : "#dfe7f5",
                  opacity: off ? 0.45 : 1,
                  padding: on ? "1px 8px 1px 6px" : undefined,
                  marginLeft: on ? -6 : undefined,
                  borderRadius: 7,
                  background: on ? `${h.color}26` : undefined,
                  boxShadow: on ? `inset 0 0 0 1px ${h.color}66` : undefined,
                  transition: "opacity 400ms ease, background 400ms ease",
                }}
              >
                <HazardGlyph id={h.hazard} color={h.color} size={18} />
                <span style={{ color: h.color, fontVariantNumeric: "tabular-nums" }}>{h.count}</span>
                <span style={{ opacity: on ? 0.95 : 0.75, fontWeight: 600 }}>{h.label}</span>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * The situation summary shown on a wide/area shot: how many hazards are on
 * screen, how severe, and of what types. A severity strip (Extreme → Minor) up
 * top for the "how much red" read at a glance, then a hazard-type breakdown with
 * icons + counts. Pure presentation off a precomputed AreaSummary.
 */
import type { AreaSummary } from "../../lib/broadcast";

export default function AreaStatus({ summary }: { summary: AreaSummary }) {
  const { total, quakeCount, bySeverity, byHazard } = summary;
  return (
    <div style={{ marginTop: 11, paddingTop: 10, borderTop: "1px solid rgba(120,140,170,0.18)" }}>
      {/* Headline counts */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc" }}>
          IN VIEW
        </span>
        <span style={{ fontSize: 20, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
          {total}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#9fb3cc" }}>
          alert{total === 1 ? "" : "s"}
        </span>
        {quakeCount ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#e08a1e" }}>
            · {quakeCount} seismic
          </span>
        ) : null}
      </div>

      {/* Severity strip — proportional bar + labelled counts. */}
      {bySeverity.length ? (
        <div style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", gap: 1 }}>
            {bySeverity.map((s) => (
              <div
                key={s.rank}
                title={`${s.label}: ${s.count}`}
                style={{ flex: s.count, background: s.color, minWidth: 3 }}
              />
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 10px", marginTop: 6 }}>
            {bySeverity.map((s) => (
              <span
                key={s.rank}
                style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700 }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                <span style={{ fontVariantNumeric: "tabular-nums", color: "#fff" }}>{s.count}</span>
                <span style={{ color: "#9fb3cc", fontWeight: 600 }}>{s.label}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Hazard-type breakdown — top types with icon + count. */}
      {byHazard.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 10px" }}>
          {byHazard.slice(0, 8).map((h) => (
            <span
              key={h.hazard}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 11.5,
                fontWeight: 700,
                color: "#dfe7f5",
              }}
            >
              <span style={{ fontSize: 12 }}>{h.icon}</span>
              <span style={{ color: h.color, fontVariantNumeric: "tabular-nums" }}>{h.count}</span>
              <span style={{ opacity: 0.75, fontWeight: 600 }}>{h.label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

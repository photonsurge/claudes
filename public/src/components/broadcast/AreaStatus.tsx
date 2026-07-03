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
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(120,140,170,0.18)" }}>
      {/* Headline counts */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 11 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.2, color: "#9fb3cc" }}>
          IN VIEW
        </span>
        <span style={{ fontSize: 28, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>
          {total}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: "#9fb3cc" }}>
          alert{total === 1 ? "" : "s"}
        </span>
        {quakeCount ? (
          <span style={{ fontSize: 15, fontWeight: 700, color: "#e08a1e" }}>
            · {quakeCount} seismic
          </span>
        ) : null}
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
                style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15, fontWeight: 700 }}
              >
                <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color }} />
                <span style={{ fontVariantNumeric: "tabular-nums", color: "#fff" }}>{s.count}</span>
                <span style={{ color: "#9fb3cc", fontWeight: 600 }}>{s.label}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Hazard-type breakdown — top types with icon + count. */}
      {byHazard.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "7px 14px" }}>
          {byHazard.slice(0, 8).map((h) => (
            <span
              key={h.hazard}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: 15.5,
                fontWeight: 700,
                color: "#dfe7f5",
              }}
            >
              <span style={{ fontSize: 17 }}>{h.icon}</span>
              <span style={{ color: h.color, fontVariantNumeric: "tabular-nums" }}>{h.count}</span>
              <span style={{ opacity: 0.75, fontWeight: 600 }}>{h.label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

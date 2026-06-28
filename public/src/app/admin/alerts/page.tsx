"use client";

/**
 * /admin/alerts — operator view of ingested weather alerts. Lists from
 * GET /api/alerts with a few filters; coloured by normalised severityRank.
 * Read-only for now (ingest is the worker's job); live Socket.IO deltas + the
 * map overlay are a later milestone.
 */
import { useCallback, useEffect, useState } from "react";
import {
  listAlerts,
  severityColor,
  severityLabel,
  primaryInfo,
  areaSummary,
  expiresLabel,
  type Alert,
} from "../../../lib/alerts";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [severityMin, setSeverityMin] = useState(0);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setAlerts(await listAlerts({ activeOnly, severityMin, limit: 500 }));
    } finally {
      setLoading(false);
    }
  }, [activeOnly, severityMin]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>
            Weather alerts{" "}
            <span style={{ color: "#8b95a7", fontSize: 14, fontWeight: 400 }}>({alerts.length})</span>
          </h2>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label style={controlLabel}>
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
              Active only
            </label>
            <label style={controlLabel}>
              Min severity
              <select
                value={severityMin}
                onChange={(e) => setSeverityMin(Number(e.target.value))}
                style={select}
              >
                {[0, 1, 2, 3, 4].map((r) => (
                  <option key={r} value={r}>
                    {r} — {severityLabel(r as 0)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={reload} style={primary} disabled={loading}>
              {loading ? "…" : "Refresh"}
            </button>
          </div>
        </div>

        <table style={{ width: "100%", marginTop: 20, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8b95a7" }}>
              <th style={th}>Sev</th>
              <th style={th}>Event</th>
              <th style={th}>Area</th>
              <th style={th}>Source</th>
              <th style={th}>Type</th>
              <th style={th}>Expires</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => {
              const info = primaryInfo(a);
              return (
                <tr key={a.id} style={{ borderTop: "1px solid #1b2030", opacity: a.active ? 1 : 0.5 }}>
                  <td style={td}>
                    <span
                      title={severityLabel(a.maxSeverityRank)}
                      style={{
                        display: "inline-block",
                        width: 26,
                        textAlign: "center",
                        borderRadius: 5,
                        padding: "2px 0",
                        fontWeight: 700,
                        color: "#0a0e16",
                        background: severityColor(a.maxSeverityRank),
                      }}
                    >
                      {a.maxSeverityRank}
                    </span>
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{info?.event ?? "—"}</div>
                    {info?.headline && (
                      <div style={{ color: "#8b95a7", fontSize: 12 }}>{info.headline}</div>
                    )}
                  </td>
                  <td style={td}>{areaSummary(a)}</td>
                  <td style={td}>{a.source}</td>
                  <td style={td}>{a.msgType}</td>
                  <td style={td}>{expiresLabel(a)}</td>
                  <td style={td}>
                    {info?.web && (
                      <a href={info.web} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>
                        link
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
            {alerts.length === 0 && (
              <tr>
                <td style={td} colSpan={7}>
                  {loading ? "Loading…" : "No alerts. The worker ingests on a schedule — check back after a tick."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
const controlLabel: React.CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "center",
  color: "#fff",
  fontSize: 13,
};
const select: React.CSSProperties = {
  background: "#1a1f2b",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 5,
  padding: "4px 6px",
};
const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px 8px", verticalAlign: "top" };

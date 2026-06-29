"use client";

/**
 * /admin/alerts — operator view of ingested weather alerts. Lists from
 * GET /api/alerts with a few filters; coloured by normalised severityRank.
 * Read-only for now (ingest is the worker's job); live Socket.IO deltas + the
 * map overlay are a later milestone.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  listAlerts,
  severityColor,
  severityLabel,
  primaryInfo,
  areaSummary,
  expiresLabel,
  alertHazard,
  type Alert,
} from "../../../lib/alerts";
import { HAZARDS, hazardMeta } from "../../../lib/hazard";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [severityMin, setSeverityMin] = useState(0);
  const [loading, setLoading] = useState(false);
  const [debugId, setDebugId] = useState<string | null>(null);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [hazardFilter, setHazardFilter] = useState("all");
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // limit 0 = no cap: fetch every matching alert (the whole world).
      setAlerts(await listAlerts({ activeOnly, severityMin, limit: 0 }));
    } finally {
      setLoading(false);
    }
  }, [activeOnly, severityMin]);

  // Trigger the worker's alerts.ingest job, then reload once it's had time to run.
  const ingestNow = useCallback(async () => {
    setIngestMsg("Queuing…");
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "alerts-ingest" }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.ok) {
        setIngestMsg(`Ingesting (job #${body.jobId})… refreshing in 8s`);
        setTimeout(() => {
          setIngestMsg(null);
          reload();
        }, 8000);
      } else {
        setIngestMsg(`Failed: ${body?.error ?? "queue unreachable"}`);
      }
    } catch (err) {
      setIngestMsg(`Failed: ${String(err)}`);
    }
  }, [reload]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Distinct adapters present in the data → the Source dropdown.
  const sources = Array.from(new Set(alerts.map((a) => a.source))).sort();
  const bySource: Record<string, number> = {};
  for (const a of alerts) bySource[a.source] = (bySource[a.source] ?? 0) + 1;

  // Hazard categories present → the Hazard dropdown (with counts).
  const byHazard: Record<string, number> = {};
  for (const a of alerts) {
    const h = alertHazard(a);
    byHazard[h] = (byHazard[h] ?? 0) + 1;
  }

  const shown = alerts.filter((a) => {
    if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
    if (hazardFilter !== "all" && alertHazard(a) !== hazardFilter) return false;
    const q = query.trim().toLowerCase();
    if (q) {
      const info = primaryInfo(a);
      const hay = `${info?.event ?? ""} ${info?.headline ?? ""} ${areaSummary(a)} ${a.source}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>
            Weather alerts{" "}
            <span style={{ color: "#8b95a7", fontSize: 14, fontWeight: 400 }}>
              ({shown.length}
              {shown.length !== alerts.length ? ` of ${alerts.length}` : ""})
            </span>
          </h2>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label style={controlLabel}>
              Source
              <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} style={select}>
                <option value="all">all adapters</option>
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {s} ({bySource[s]})
                  </option>
                ))}
              </select>
            </label>
            <label style={controlLabel}>
              Hazard
              <select value={hazardFilter} onChange={(e) => setHazardFilter(e.target.value)} style={select}>
                <option value="all">all types</option>
                {HAZARDS.filter((h) => byHazard[h.id]).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.icon} {h.label} ({byHazard[h.id]})
                  </option>
                ))}
              </select>
            </label>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="type / area…"
              style={{
                background: "#0a0e16",
                color: "#fff",
                border: "1px solid #2a3344",
                borderRadius: 5,
                padding: "5px 8px",
                fontSize: 13,
                minWidth: 130,
              }}
            />
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
            <button type="button" onClick={ingestNow} style={ingestBtn} disabled={!!ingestMsg}>
              Ingest now
            </button>
          </div>
        </div>
        {ingestMsg && (
          <div style={{ marginTop: 8, fontSize: 13, color: ingestMsg.startsWith("Failed") ? "#fca5a5" : "#86efac" }}>
            {ingestMsg}
          </div>
        )}

        <table style={{ width: "100%", marginTop: 20, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8b95a7" }}>
              <th style={th}>Sev</th>
              <th style={th}>Hazard</th>
              <th style={th}>Event</th>
              <th style={th}>Area</th>
              <th style={th}>Source</th>
              <th style={th}>Msg</th>
              <th style={th}>Expires</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const info = primaryInfo(a);
              return (
                <Fragment key={a.id}>
                <tr style={{ borderTop: "1px solid #1b2030", opacity: a.active ? 1 : 0.5 }}>
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
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {(() => {
                      const h = hazardMeta(alertHazard(a));
                      // Chip intensity scales with severityRank (0–4): a minor
                      // alert is a faint tint, an extreme one is a bold fill.
                      const rank = a.maxSeverityRank;
                      const hx = (n: number) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0");
                      return (
                        <span
                          title={`${h.label} · ${severityLabel(rank)}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 11,
                            fontSize: 12,
                            fontWeight: rank >= 3 ? 700 : 500,
                            background: `${h.color}${hx(0x12 + rank * 0x18)}`,
                            color: h.color,
                            border: `1px solid ${h.color}${hx(0x3a + rank * 0x32)}`,
                          }}
                        >
                          {h.icon} {h.label}
                        </span>
                      );
                    })()}
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
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      onClick={() => setDebugId(debugId === a.id ? null : a.id)}
                      style={debugBtn}
                      aria-expanded={debugId === a.id}
                    >
                      {debugId === a.id ? "Hide" : "Debug"}
                    </button>
                    {info?.web && (
                      <a
                        href={info.web}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#60a5fa", marginLeft: 8 }}
                      >
                        link
                      </a>
                    )}
                  </td>
                </tr>
                {debugId === a.id && (
                  <tr>
                    <td colSpan={8} style={{ padding: 0, borderTop: "1px solid #1b2030" }}>
                      <pre style={debugPre}>{JSON.stringify(a, null, 2)}</pre>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td style={td} colSpan={8}>
                  {loading
                    ? "Loading…"
                    : alerts.length
                      ? "No alerts match the current filters."
                      : "No alerts. Trigger an ingest or wait for the worker's tick."}
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
const ingestBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #2a3344",
  background: "#14532d",
  color: "#bbf7d0",
  cursor: "pointer",
};
const debugBtn: React.CSSProperties = {
  padding: "3px 9px",
  borderRadius: 5,
  border: "1px solid #2a3344",
  background: "#1a1f2b",
  color: "#8b95a7",
  cursor: "pointer",
  fontSize: 12,
};
const debugPre: React.CSSProperties = {
  margin: 0,
  padding: "12px 14px",
  background: "#070a11",
  color: "#9ca3af",
  fontSize: 11,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 380,
  overflow: "auto",
};

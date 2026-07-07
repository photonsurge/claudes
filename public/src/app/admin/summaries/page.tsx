"use client";

/**
 * /admin/summaries — the round-ups screen. Shows the latest scheduled global
 * weather-event summary per cadence (hourly / 12h / daily): the LLM narrative,
 * headline stats, geographic hotspots, top events, and a history list. The
 * worker generates these on a cron; "Generate now" triggers one on demand and a
 * Socket.IO `summaries:updated` event live-refreshes the view.
 */
import { useCallback, useEffect, useState } from "react";
import { SUMMARIES_UPDATED } from "@photonsurge/shared/control";
import { useSocket } from "../../../lib/socket-provider";
import { severityColor, severityLabel } from "../../../lib/alerts";
import { hazardMeta } from "../../../lib/hazard";
import {
  getSummaries,
  SUMMARY_PERIODS,
  type SummaryPeriod,
  type EventSummary,
} from "../../../lib/summaries";

const fmtTime = (iso?: string | Date): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toUTCString().replace("GMT", "UTC");
};

export default function SummariesPage() {
  const { socket } = useSocket();
  const [period, setPeriod] = useState<SummaryPeriod>("hourly");
  const [latest, setLatest] = useState<EventSummary | null>(null);
  const [history, setHistory] = useState<EventSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSummaries(period, 20);
      setLatest(res.latest);
      setHistory(res.history);
      setSelectedId(res.latest?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Live refresh when the worker finishes a round-up for the current cadence.
  useEffect(() => {
    if (!socket) return;
    const onUpdate = (p: { period?: SummaryPeriod }) => {
      if (!p?.period || p.period === period) reload();
    };
    socket.on(SUMMARIES_UPDATED, onUpdate);
    return () => {
      socket.off(SUMMARIES_UPDATED, onUpdate);
    };
  }, [socket, period, reload]);

  const generateNow = useCallback(async () => {
    const meta = SUMMARY_PERIODS.find((p) => p.id === period);
    if (!meta) return;
    setGenMsg("Queuing…");
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: meta.jobId }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.ok) {
        setGenMsg(`Generating (job #${body.jobId})… refreshing in 10s`);
        setTimeout(() => {
          setGenMsg(null);
          reload();
        }, 10000);
      } else {
        setGenMsg(`Failed: ${body?.error ?? "queue unreachable"}`);
      }
    } catch (err) {
      setGenMsg(`Failed: ${String(err)}`);
    }
  }, [period, reload]);

  const shown = history.find((h) => h.id === selectedId) ?? latest;

  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>
            Round-ups{" "}
            <span style={{ color: "#8b95a7", fontSize: 14, fontWeight: 400 }}>
              global weather-event summaries
            </span>
          </h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 2, background: "#0c111c", border: "1px solid #1b2030", borderRadius: 8, padding: 3 }}>
              {SUMMARY_PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  style={{
                    ...tabBtn,
                    ...(period === p.id ? { background: "#2563eb", color: "#fff" } : null),
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={reload} style={primary} disabled={loading}>
              {loading ? "…" : "Refresh"}
            </button>
            <button type="button" onClick={generateNow} style={genBtn} disabled={!!genMsg}>
              Generate now
            </button>
          </div>
        </div>
        {genMsg && (
          <div style={{ marginTop: 8, fontSize: 13, color: genMsg.startsWith("Failed") ? "#fca5a5" : "#86efac" }}>
            {genMsg}
          </div>
        )}

        {!shown ? (
          <div style={{ marginTop: 24, color: "#8b95a7" }}>
            {loading
              ? "Loading…"
              : "No round-up yet for this cadence. Click “Generate now” or wait for the worker's cron."}
          </div>
        ) : (
          <>
            <div style={{ marginTop: 10, color: "#8b95a7", fontSize: 13 }}>
              Generated {fmtTime(shown.generatedAt)} · window {fmtTime(shown.windowStart)} → {fmtTime(shown.windowEnd)}
              {shown.sources.length ? ` · sources: ${shown.sources.join(", ")}` : ""}
            </div>

            {/* Stats cards */}
            <div style={cardRow}>
              <StatCard label="Active alerts" value={shown.stats.alertsActive} />
              <StatCard label="Cyclones" value={shown.stats.cyclones} />
              <StatCard
                label="Earthquakes"
                value={shown.stats.quakeCount}
                sub={shown.stats.quakeMaxMag ? `max M${shown.stats.quakeMaxMag.toFixed(1)}` : undefined}
              />
              <StatCard
                label="Volcanoes"
                value={shown.stats.volcanoCount}
                sub={shown.stats.volcanoErupting ? `${shown.stats.volcanoErupting} erupting` : undefined}
              />
              <StatCard label="Notable tracks" value={shown.stats.tracksNotable} />
              <div style={{ ...card, flex: "1 1 260px" }}>
                <div style={cardLabel}>Alerts by severity</div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {[4, 3, 2, 1, 0].map((r) => {
                    const n = shown.stats.alertsBySeverity[String(r)] ?? 0;
                    if (!n) return null;
                    return (
                      <span
                        key={r}
                        title={severityLabel(r as 0)}
                        style={{
                          display: "inline-flex",
                          gap: 4,
                          padding: "2px 8px",
                          borderRadius: 11,
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#0a0e16",
                          background: severityColor(r as 0),
                        }}
                      >
                        {r} · {n}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Narrative */}
            <div style={{ ...card, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={cardLabel}>Broadcast round-up</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>
                  {shown.narrativeStatus === "ok"
                    ? `narrative by ${shown.llm?.model ?? "LLM"}${shown.llm?.completionTokens ? ` · ${shown.llm.completionTokens} tok` : ""}`
                    : shown.narrativeStatus === "skipped"
                      ? "narrative skipped (no OPENROUTER_API_KEY)"
                      : `narrative error: ${shown.llm?.error ?? "unknown"}`}
                </div>
              </div>
              {shown.narrative ? (
                <pre style={narrativePre}>{shown.narrative}</pre>
              ) : (
                <div style={{ color: "#6b7280", fontSize: 13, marginTop: 10, fontStyle: "italic" }}>
                  No narrative — the deterministic stats, hotspots and top events below are still available.
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginTop: 16 }}>
              {/* Hotspots */}
              <div style={card}>
                <div style={cardLabel}>Hotspots ({shown.hotspots.length})</div>
                <div style={{ marginTop: 8 }}>
                  {shown.hotspots.slice(0, 12).map((hs, i) => (
                    <div key={i} style={hotspotRow}>
                      <span
                        title={severityLabel(hs.maxSeverity)}
                        style={{
                          display: "inline-block",
                          width: 22,
                          textAlign: "center",
                          borderRadius: 5,
                          padding: "2px 0",
                          fontWeight: 700,
                          color: "#0a0e16",
                          background: severityColor(hs.maxSeverity),
                          flexShrink: 0,
                        }}
                      >
                        {hs.maxSeverity}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{hs.label}</div>
                        <div style={{ color: "#8b95a7", fontSize: 12 }}>
                          {hs.count} event{hs.count === 1 ? "" : "s"}
                          {hs.hazards.length ? ` · ${hs.hazards.map((h) => hazardMeta(h as "other").icon).join(" ")}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!shown.hotspots.length && <div style={{ color: "#6b7280", fontSize: 13 }}>No hotspots.</div>}
                </div>
              </div>

              {/* Top events */}
              <div style={card}>
                <div style={cardLabel}>Top events ({shown.topEvents.length})</div>
                <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {shown.topEvents.map((ev, i) => (
                      <tr key={i} style={{ borderTop: i ? "1px solid #1b2030" : undefined }}>
                        <td style={{ padding: "6px 6px 6px 0", verticalAlign: "top", width: 26 }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 22,
                              textAlign: "center",
                              borderRadius: 5,
                              padding: "2px 0",
                              fontWeight: 700,
                              color: "#0a0e16",
                              background: severityColor(ev.severity),
                            }}
                          >
                            {ev.severity}
                          </span>
                        </td>
                        <td style={{ padding: "6px 0", verticalAlign: "top" }}>
                          <div style={{ fontWeight: 600 }}>{ev.title}</div>
                          <div style={{ color: "#8b95a7", fontSize: 12 }}>
                            {ev.kind}
                            {ev.source ? ` · ${ev.source}` : ""}
                            {ev.at ? ` · ${fmtTime(ev.at)}` : ""}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!shown.topEvents.length && (
                      <tr>
                        <td style={{ color: "#6b7280", fontSize: 13, padding: 6 }}>No events.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* History */}
            {history.length > 1 && (
              <div style={{ ...card, marginTop: 16 }}>
                <div style={cardLabel}>History</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                  {history.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setSelectedId(h.id)}
                      style={{
                        ...historyChip,
                        ...(h.id === selectedId ? { borderColor: "#2563eb", color: "#fff" } : null),
                      }}
                    >
                      {fmtTime(h.generatedAt)} · {h.hotspots.length} hs
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div style={card}>
      <div style={cardLabel}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: "#8b95a7", fontSize: 12 }}>{sub}</div>}
    </div>
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
const genBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #2a3344",
  background: "#14532d",
  color: "#bbf7d0",
  cursor: "pointer",
};
const tabBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  border: "none",
  background: "transparent",
  color: "#8b95a7",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const card: React.CSSProperties = {
  flex: "1 1 150px",
  padding: 14,
  borderRadius: 8,
  border: "1px solid #1b2030",
  background: "#0c111c",
};
const cardRow: React.CSSProperties = {
  display: "flex",
  gap: 14,
  marginTop: 16,
  flexWrap: "wrap",
};
const cardLabel: React.CSSProperties = { color: "#8b95a7", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 };
const hotspotRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  padding: "6px 0",
  borderTop: "1px solid #121622",
};
const historyChip: React.CSSProperties = {
  padding: "4px 9px",
  borderRadius: 6,
  border: "1px solid #2a3344",
  background: "#0a0e16",
  color: "#8b95a7",
  cursor: "pointer",
  fontSize: 12,
};
const narrativePre: React.CSSProperties = {
  margin: "10px 0 0",
  padding: "12px 14px",
  background: "#070a11",
  color: "#e2e8f0",
  fontSize: 14,
  lineHeight: 1.6,
  fontFamily: "system-ui, sans-serif",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  borderRadius: 6,
};

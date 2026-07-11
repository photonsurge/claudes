"use client";

/**
 * /admin/place-roundups — the per-country / per-region AI round-ups screen.
 * Left: the places that have a round-up (latest per place) for the selected
 * kind. Right: the chosen place's LLM narrative, the exact inputs it was built
 * from (top cities + capital, area-weather, alerts, volcanoes, gauges), and a
 * history strip. "Generate now" enqueues the matching worker job; a Socket.IO
 * `placeRoundups:updated` event live-refreshes the view. Countries opt in via
 * the toggle on /countries; regions always generate.
 */
import { useCallback, useEffect, useState } from "react";
import { PLACE_ROUNDUPS_UPDATED } from "@photonsurge/shared/control";
import { useSocket } from "../../../lib/socket-provider";
import {
  getPlaceRoundups,
  getPlaceRoundupDetail,
  PLACE_ROUNDUP_KINDS,
  type PlaceRoundup,
  type PlaceRoundupKind,
} from "../../../lib/placeRoundups";
import AdminPageShell from "../../../components/admin/AdminPageShell";

const fmtTime = (iso?: string | Date): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toUTCString().replace("GMT", "UTC");
};
const num = (v?: number, digits = 0): string => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—");
const statusColor = (s: PlaceRoundup["narrativeStatus"]) =>
  s === "ok" ? "#34d399" : s === "skipped" ? "#8b95a7" : "#fca5a5";

export default function PlaceRoundupsPage() {
  const { socket } = useSocket();
  const [kind, setKind] = useState<PlaceRoundupKind>("country");
  const [places, setPlaces] = useState<PlaceRoundup[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [latest, setLatest] = useState<PlaceRoundup | null>(null);
  const [history, setHistory] = useState<PlaceRoundup[]>([]);
  const [shownId, setShownId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPlaceRoundups(kind);
      setPlaces(res.places);
      setPlaceId((cur) => cur ?? res.places[0]?.placeId ?? null);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  const loadDetail = useCallback(async () => {
    if (!placeId) {
      setLatest(null);
      setHistory([]);
      return;
    }
    const res = await getPlaceRoundupDetail(kind, placeId);
    setLatest(res.latest);
    setHistory(res.history);
    setShownId(res.latest?.id ?? null);
  }, [kind, placeId]);

  // Reset the selection when switching kinds so the first place of the new kind wins.
  useEffect(() => {
    setPlaceId(null);
  }, [kind]);
  useEffect(() => {
    loadIndex();
  }, [loadIndex]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Live refresh when the worker finishes a round-up for this kind.
  useEffect(() => {
    if (!socket) return;
    const onUpdate = (p: { placeKind?: PlaceRoundupKind; placeId?: string }) => {
      if (p?.placeKind && p.placeKind !== kind) return;
      loadIndex();
      if (!p?.placeId || p.placeId === placeId) loadDetail();
    };
    socket.on(PLACE_ROUNDUPS_UPDATED, onUpdate);
    return () => {
      socket.off(PLACE_ROUNDUPS_UPDATED, onUpdate);
    };
  }, [socket, kind, placeId, loadIndex, loadDetail]);

  const generateNow = useCallback(async () => {
    const meta = PLACE_ROUNDUP_KINDS.find((k) => k.id === kind);
    if (!meta) return;
    setGenMsg("Queuing…");
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: meta.jobId }),
      });
      const body = await res.json().catch(() => ({}));
      setGenMsg(
        body?.ok
          ? `Generating (job #${body.jobId})… live-refreshes as each place lands.`
          : `Failed: ${body?.error ?? "queue unreachable"}`,
      );
      if (body?.ok) setTimeout(() => setGenMsg(null), 8000);
    } catch (err) {
      setGenMsg(`Failed: ${String(err)}`);
    }
  }, [kind]);

  const shown = history.find((h) => h.id === shownId) ?? latest;

  return (
    <AdminPageShell
      title="Place round-ups"
      description="Per-country and per-region 12-hour AI round-ups — each written with the previous one in view."
      maxWidth={1500}
      actions={
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 2, background: "#0c111c", border: "1px solid #1b2030", borderRadius: 8, padding: 3 }}>
            {PLACE_ROUNDUP_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                style={{ ...tabBtn, ...(kind === k.id ? { background: "#2563eb", color: "#fff" } : null) }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={loadIndex} style={primary} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </button>
          <button type="button" onClick={generateNow} style={genBtn} disabled={!!genMsg}>
            Generate now
          </button>
        </div>
      }
    >
      {genMsg && (
        <div style={{ marginTop: 8, fontSize: 13, color: genMsg.startsWith("Failed") ? "#fca5a5" : "#86efac" }}>{genMsg}</div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Places list */}
        <div style={{ ...card, flex: "0 0 300px", maxHeight: "72vh", overflowY: "auto" }}>
          <div style={cardLabel}>
            {kind === "country" ? "Countries" : "Regions"} ({places.length})
          </div>
          <div style={{ marginTop: 8 }}>
            {places.map((p) => (
              <button
                key={p.placeId}
                type="button"
                onClick={() => setPlaceId(p.placeId)}
                style={{ ...placeRow, ...(p.placeId === placeId ? { background: "#13192a", borderColor: "#2563eb" } : null) }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(p.narrativeStatus), flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <span style={{ color: "#6b7280", fontSize: 11 }}>{p.inputs?.alertsTotal ?? p.inputs?.alerts?.length ?? 0}⚠</span>
              </button>
            ))}
            {!places.length && (
              <div style={{ color: "#6b7280", fontSize: 13, padding: 6 }}>
                {loading ? "Loading…" : `No round-ups yet. ${kind === "country" ? "Enable a country on /countries, then " : ""}click “Generate now”.`}
              </div>
            )}
          </div>
        </div>

        {/* Detail */}
        <div style={{ flex: "1 1 520px", minWidth: 320 }}>
          {!shown ? (
            <div style={{ color: "#8b95a7", padding: 20 }}>Select a place to see its round-up.</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 22 }}>{shown.name}</h2>
                <div style={{ color: "#8b95a7", fontSize: 12 }}>
                  Generated {fmtTime(shown.generatedAt)}
                  {shown.prevRoundupId ? " · continues previous" : " · first round-up"}
                </div>
              </div>

              {/* Narrative */}
              <div style={{ ...card, marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={cardLabel}>Broadcast round-up</div>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    {shown.narrativeStatus === "ok"
                      ? `by ${shown.llm?.model ?? "LLM"}${shown.llm?.completionTokens ? ` · ${shown.llm.completionTokens} tok` : ""}`
                      : shown.narrativeStatus === "skipped"
                        ? "skipped (no OPENROUTER_API_KEY)"
                        : `error: ${shown.llm?.error ?? "unknown"}`}
                  </div>
                </div>
                {shown.narrative ? (
                  <pre style={narrativePre}>{shown.narrative}</pre>
                ) : (
                  <div style={{ color: "#6b7280", fontSize: 13, marginTop: 10, fontStyle: "italic" }}>
                    No narrative — the deterministic inputs below are still stored.
                  </div>
                )}
              </div>

              {/* Inputs the LLM saw */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginTop: 14 }}>
                {/* Cities */}
                <div style={card}>
                  <div style={cardLabel}>City conditions ({shown.inputs?.topCities?.length ?? 0})</div>
                  <table style={miniTable}>
                    <tbody>
                      {(shown.inputs?.topCities ?? []).map((c, i) => (
                        <tr key={i} style={{ borderTop: i ? "1px solid #1b2030" : undefined }}>
                          <td style={{ padding: "5px 6px 5px 0", fontWeight: 600 }}>
                            {c.isCapital ? "★ " : ""}
                            {c.name}
                          </td>
                          <td style={tdNum}>{num(c.temp)}°C</td>
                          <td style={tdNum}>{num(c.wind)} m/s</td>
                          <td style={tdNum}>{c.hi != null || c.lo != null ? `${num(c.hi)}/${num(c.lo)}` : "—"}</td>
                        </tr>
                      ))}
                      {!(shown.inputs?.topCities ?? []).length && <tr><td style={muted}>No cached city weather.</td></tr>}
                    </tbody>
                  </table>
                </div>

                {/* Area weather */}
                <div style={card}>
                  <div style={cardLabel}>Area weather</div>
                  <table style={miniTable}>
                    <tbody>
                      {(shown.inputs?.area?.stats ?? []).map((s, i) => (
                        <tr key={i} style={{ borderTop: i ? "1px solid #1b2030" : undefined }}>
                          <td style={{ padding: "5px 6px 5px 0", fontWeight: 600 }}>{s.variable}</td>
                          <td style={tdNum}>μ {num(s.mean, 1)}{s.units}</td>
                          <td style={tdNum}>{num(s.min, 1)}–{num(s.max, 1)}</td>
                        </tr>
                      ))}
                      {!(shown.inputs?.area?.stats ?? []).length && <tr><td style={muted}>No area-weather snapshot yet.</td></tr>}
                    </tbody>
                  </table>
                  {!!(shown.inputs?.area?.hazards ?? []).length && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {shown.inputs!.area!.hazards.map((h, i) => (
                        <span key={i} style={chip}>{h.label}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Alerts */}
                <div style={card}>
                  <div style={cardLabel}>
                    Active alerts ({shown.inputs?.alerts?.length ?? 0}
                    {shown.inputs?.alertsTotal && shown.inputs.alertsTotal > (shown.inputs.alerts?.length ?? 0)
                      ? ` of ${shown.inputs.alertsTotal}`
                      : ""}
                    )
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {(shown.inputs?.alerts ?? []).slice(0, 20).map((a, i) => (
                      <div key={i} style={{ fontSize: 13, padding: "4px 0", borderTop: i ? "1px solid #121622" : undefined }}>
                        <span style={{ fontWeight: 600 }}>{a.event}</span>
                        <span style={{ color: "#8b95a7" }}> · sev {a.severityRank}{a.hazard ? ` · ${a.hazard}` : ""}{a.source ? ` · ${a.source}` : ""}</span>
                      </div>
                    ))}
                    {!(shown.inputs?.alerts ?? []).length && <div style={muted}>None active.</div>}
                  </div>
                </div>

                {/* Volcanoes + gauges */}
                <div style={card}>
                  <div style={cardLabel}>Volcanoes & gauges</div>
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    {(shown.inputs?.volcanoes ?? []).map((v, i) => (
                      <div key={`v${i}`} style={{ padding: "3px 0" }}>🌋 {v.name} · {v.status}</div>
                    ))}
                    {(shown.inputs?.tideGauges ?? []).map((g, i) => (
                      <div key={`t${i}`} style={{ padding: "3px 0" }}>🌊 {g.name} · {num(g.latest, 2)} m{g.distanceKm != null ? ` · ${g.distanceKm} km` : ""}</div>
                    ))}
                    {(shown.inputs?.seismoStations ?? []).map((g, i) => (
                      <div key={`s${i}`} style={{ padding: "3px 0" }}>📈 {g.name}{g.distanceKm != null ? ` · ${g.distanceKm} km` : ""}</div>
                    ))}
                    {!(shown.inputs?.volcanoes ?? []).length &&
                      !(shown.inputs?.tideGauges ?? []).length &&
                      !(shown.inputs?.seismoStations ?? []).length && <div style={muted}>None in range.</div>}
                  </div>
                </div>
              </div>

              {/* History */}
              {history.length > 1 && (
                <div style={{ ...card, marginTop: 14 }}>
                  <div style={cardLabel}>History</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                    {history.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => setShownId(h.id)}
                        style={{ ...historyChip, ...(h.id === shownId ? { borderColor: "#2563eb", color: "#fff" } : null) }}
                      >
                        {fmtTime(h.generatedAt)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AdminPageShell>
  );
}

const primary: React.CSSProperties = { padding: "8px 14px", borderRadius: 6, border: "1px solid #333", background: "#2563eb", color: "#fff", cursor: "pointer" };
const genBtn: React.CSSProperties = { padding: "8px 14px", borderRadius: 6, border: "1px solid #2a3344", background: "#14532d", color: "#bbf7d0", cursor: "pointer" };
const tabBtn: React.CSSProperties = { padding: "6px 14px", borderRadius: 6, border: "none", background: "transparent", color: "#8b95a7", cursor: "pointer", fontSize: 13, fontWeight: 600 };
const card: React.CSSProperties = { padding: 14, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" };
const cardLabel: React.CSSProperties = { color: "#8b95a7", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 };
const placeRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 8px", marginTop: 4, borderRadius: 6, border: "1px solid #1b2030", background: "#0a0e16", color: "#dbeafe", cursor: "pointer", fontSize: 13 };
const miniTable: React.CSSProperties = { width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 13 };
const tdNum: React.CSSProperties = { padding: "5px 0", textAlign: "right", color: "#8b95a7", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const muted: React.CSSProperties = { color: "#6b7280", fontSize: 13, padding: "6px 0" };
const chip: React.CSSProperties = { padding: "2px 8px", borderRadius: 11, fontSize: 12, background: "#1a1f2b", color: "#fbbf24", border: "1px solid #2a3344" };
const historyChip: React.CSSProperties = { padding: "4px 9px", borderRadius: 6, border: "1px solid #2a3344", background: "#0a0e16", color: "#8b95a7", cursor: "pointer", fontSize: 12 };
const narrativePre: React.CSSProperties = { margin: "10px 0 0", padding: "12px 14px", background: "#070a11", color: "#e2e8f0", fontSize: 14, lineHeight: 1.6, fontFamily: "system-ui, sans-serif", whiteSpace: "pre-wrap", wordBreak: "break-word", borderRadius: 6 };

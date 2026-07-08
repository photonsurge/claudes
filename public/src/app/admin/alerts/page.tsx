"use client";

/**
 * /admin/alerts — operator view of ingested weather alerts. Lists from
 * GET /api/alerts with a few filters; coloured by normalised severityRank.
 * Read-only for now (ingest is the worker's job); live Socket.IO deltas + the
 * map overlay are a later milestone.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  listAlerts,
  severityColor,
  severityLabel,
  primaryInfo,
  areaSummary,
  expiresLabel,
  alertHazard,
  translationStatus,
  displayHeadline,
  displayDescription,
  displayInstruction,
  type Alert,
  type AlertInfo,
} from "../../../lib/alerts";
import { HAZARDS, hazardMeta } from "../../../lib/hazard";
import { bucketByGroupId } from "../../../lib/alertGroups";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [severityMin, setSeverityMin] = useState(0);
  const [loading, setLoading] = useState(false);
  const [debugId, setDebugId] = useState<string | null>(null);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [translateMsg, setTranslateMsg] = useState<string | null>(null);
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

  // Trigger the worker's alerts.translate (LLM) job. Sequential per-alert calls
  // make this slower than ingest, so give it more time before auto-refreshing.
  const translateNow = useCallback(async () => {
    setTranslateMsg("Queuing…");
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "alerts-translate" }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.ok) {
        setTranslateMsg(`Translating (job #${body.jobId})… refreshing in 20s`);
        setTimeout(() => {
          setTranslateMsg(null);
          reload();
        }, 20000);
      } else {
        setTranslateMsg(`Failed: ${body?.error ?? "queue unreachable"}`);
      }
    } catch (err) {
      setTranslateMsg(`Failed: ${String(err)}`);
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
      const hay = `${info?.event ?? ""} ${displayHeadline(info) ?? ""} ${displayDescription(info) ?? ""} ${areaSummary(a)} ${a.source}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Cluster same-event rows by the server-assigned groupId (cheap O(n); the
  // heavy geometry clustering runs in /api/alerts, not the browser).
  const groups = bucketByGroupId(shown);

  // The group whose Debug view is open in the full-screen modal (if any).
  const debugGroup = debugId ? groups.find((g) => g.id === debugId) ?? null : null;

  // Close the modal on Escape.
  useEffect(() => {
    if (!debugGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDebugId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [debugGroup]);

  return (
    <AdminPageShell
      title="Weather alerts"
      description={
        <>
          {groups.length} event{groups.length === 1 ? "" : "s"}
          {shown.length !== groups.length ? ` · ${shown.length} alerts` : ""}
          {shown.length !== alerts.length ? ` of ${alerts.length}` : ""}
        </>
      }
      actions={
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
          <button type="button" onClick={translateNow} style={ingestBtn} disabled={!!translateMsg}>
            Translate now
          </button>
        </div>
      }
    >
        {ingestMsg && (
          <div style={{ marginTop: 8, fontSize: 13, color: ingestMsg.startsWith("Failed") ? "#fca5a5" : "#86efac" }}>
            {ingestMsg}
          </div>
        )}
        {translateMsg && (
          <div style={{ marginTop: 8, fontSize: 13, color: translateMsg.startsWith("Failed") ? "#fca5a5" : "#86efac" }}>
            {translateMsg}
          </div>
        )}

        <table style={{ width: "100%", marginTop: 20, borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#8b95a7" }}>
              <th style={th}>Sev</th>
              <th style={th}>Hazard</th>
              <th style={th}>Event</th>
              <th style={th}>Area</th>
              <th style={th}>Sources</th>
              <th style={th}>Msg</th>
              <th style={th}>Translated</th>
              <th style={th}>Expires</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const rep = g.representative;
              const info = primaryInfo(rep);
              const multi = g.members.length > 1;
              const h = hazardMeta(g.hazard);
              const rank = g.maxSeverityRank;
              const hx = (n: number) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0");
              return (
                <Fragment key={g.id}>
                <tr style={{ borderTop: "1px solid #1b2030", opacity: rep.active ? 1 : 0.5 }}>
                  <td style={td}>
                    <span
                      title={severityLabel(rank)}
                      style={{
                        display: "inline-block",
                        width: 26,
                        textAlign: "center",
                        borderRadius: 5,
                        padding: "2px 0",
                        fontWeight: 700,
                        color: "#0a0e16",
                        background: severityColor(rank),
                      }}
                    >
                      {rank}
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {/* Chip intensity scales with severityRank (0–4). */}
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
                  </td>
                  <td style={td}>
                    {(() => {
                      const headline = displayHeadline(info) ?? info?.event ?? "—";
                      const isTranslated = !!info?.translatedHeadline;
                      const lang = info?.detectedLanguage;
                      return (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                            <span>{headline}</span>
                            {isTranslated && lang && (
                              <span title={`Machine-translated from "${lang}"`} style={langTag}>
                                {lang.toUpperCase()}→EN
                              </span>
                            )}
                          </div>
                          {info?.event && info.event !== headline && (
                            <div style={{ color: "#8b95a7", fontSize: 12 }}>{info.event}</div>
                          )}
                          {isTranslated && info?.headline && info.headline !== headline && (
                            <div style={{ color: "#5b6478", fontSize: 11, fontStyle: "italic" }}>
                              orig: {info.headline}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td style={td}>{areaSummary(rep)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                      {g.sources.map((s) => (
                        <span
                          key={s}
                          style={{
                            ...sourceChip,
                            ...(g.sources.length > 1
                              ? { background: "#1e3a5f", color: "#93c5fd", borderColor: "#2c5a8f" }
                              : null),
                          }}
                        >
                          {s}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td style={td}>{rep.msgType}</td>
                  <td style={td}>{translatedBadge(translationStatus(rep))}</td>
                  <td style={td}>{expiresLabel(rep)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      onClick={() => setDebugId(debugId === g.id ? null : g.id)}
                      style={debugBtn}
                      aria-expanded={debugId === g.id}
                    >
                      {debugId === g.id ? "Hide" : multi ? `Debug (${g.members.length})` : "Debug"}
                    </button>
                    <Link href={`/admin/alerts/${rep.id}`} style={{ color: "#60a5fa", marginLeft: 8 }}>
                      Details
                    </Link>
                    {info?.web && (
                      <a href={info.web} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", marginLeft: 8 }}>
                        link
                      </a>
                    )}
                  </td>
                </tr>
                </Fragment>
              );
            })}
            {groups.length === 0 && (
              <tr>
                <td style={td} colSpan={9}>
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


      {debugGroup && (() => {
        const rep = debugGroup.representative;
        const info = primaryInfo(rep);
        const multi = debugGroup.members.length > 1;
        const h = hazardMeta(debugGroup.hazard);
        return (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setDebugId(null)}
            style={modalOverlay}
          >
            <div onClick={(e) => e.stopPropagation()} style={modalPanel}>
              <header style={modalHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ color: h.color, fontSize: 15 }}>
                    {h.icon} {h.label}
                  </span>
                  <span style={{ color: "#e5e7eb", fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {info?.event ?? "—"}
                  </span>
                </div>
                <button type="button" onClick={() => setDebugId(null)} style={modalClose} aria-label="Close">
                  ✕
                </button>
              </header>
              {multi && (
                <div style={{ padding: "10px 18px", color: "#8b95a7", fontSize: 13, borderBottom: "1px solid #1b2030", flexShrink: 0 }}>
                  {debugGroup.members.length} alerts from {debugGroup.sources.length} source
                  {debugGroup.sources.length === 1 ? "" : "s"} matched by overlapping area + hazard:
                  {debugGroup.members.map((m) => (
                    <div key={m.id} style={{ color: "#cbd5e1", marginTop: 4 }}>
                      <span style={{ ...sourceChip, marginRight: 6 }}>{m.source}</span>
                      {primaryInfo(m)?.event} — {areaSummary(m)}
                      <Link href={`/admin/alerts/${m.id}`} style={{ color: "#60a5fa", marginLeft: 8 }}>
                        details
                      </Link>
                    </div>
                  ))}
                </div>
              )}
              {info && <TranslationDebugPanel info={info} />}
              <pre style={modalPre}>{JSON.stringify(multi ? debugGroup.members : rep, null, 2)}</pre>
            </div>
          </div>
        );
      })()}
    </AdminPageShell>
  );
}

/** "Translated" (green) / "English source" (gray) / "Pending" (amber) — mirrors
 *  VolcanoesTable's wikiStatus() badge convention. */
function translatedBadge(status: "translated" | "english" | "pending") {
  const meta =
    status === "translated"
      ? { label: "Translated", color: "#34d399" }
      : status === "english"
        ? { label: "English source", color: "#8b95a7" }
        : { label: "Pending", color: "#fbbf24" };
  return <span style={{ color: meta.color }}>{meta.label}</span>;
}

/** Original-vs-translated debug view (Debug modal) — one row per field, blank rows
 *  hidden. Shown before the raw JSON dump so translation quality is checkable at
 *  a glance instead of hunting through the doc. */
function TranslationDebugPanel({ info }: { info: AlertInfo }) {
  const rows: { label: string; original?: string; translated?: string }[] = [
    { label: "Headline", original: info.headline, translated: info.translatedHeadline },
    { label: "Description", original: info.description, translated: info.translatedDescription },
    { label: "Instruction", original: info.instruction, translated: info.translatedInstruction },
  ].filter((r) => r.original || r.translated);

  if (!rows.length) return null;

  return (
    <div style={{ padding: "12px 18px", borderBottom: "1px solid #1b2030", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ color: "#8b95a7", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>TRANSLATION</span>
        {info.detectedLanguage ? (
          <span style={langTag}>{info.detectedLanguage.toUpperCase()}→EN</span>
        ) : (
          <span style={{ color: "#5b6478", fontSize: 11, fontStyle: "italic" }}>not yet processed</span>
        )}
        {info.translatedAt && (
          <span style={{ color: "#5b6478", fontSize: 11 }}>{new Date(info.translatedAt).toLocaleString()}</span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", rowGap: 8, columnGap: 10, fontSize: 12.5 }}>
        {rows.map((r) => (
          <Fragment key={r.label}>
            <div style={{ color: "#8b95a7" }}>{r.label}</div>
            <div>
              <div style={{ color: "#cbd5e1" }}>{r.translated || r.original || "—"}</div>
              {r.translated && r.original && r.translated !== r.original && (
                <div style={{ color: "#5b6478", fontStyle: "italic", marginTop: 2 }}>orig: {r.original}</div>
              )}
            </div>
          </Fragment>
        ))}
      </div>
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
const langTag: React.CSSProperties = {
  display: "inline-block",
  padding: "0px 5px",
  borderRadius: 4,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.3,
  background: "#1e3a5f",
  color: "#93c5fd",
  border: "1px solid #2c5a8f",
};
const sourceChip: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 7px",
  borderRadius: 9,
  fontSize: 11,
  background: "#1a1f2b",
  color: "#8b95a7",
  border: "1px solid #2a3344",
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
const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(3, 6, 12, 0.8)",
  backdropFilter: "blur(2px)",
  display: "flex",
  alignItems: "stretch",
  justifyContent: "center",
  padding: 24,
  zIndex: 1000,
};
const modalPanel: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  maxWidth: 1100,
  background: "#0a0e16",
  border: "1px solid #2a3344",
  borderRadius: 10,
  overflow: "hidden",
  boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
};
const modalHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "12px 18px",
  borderBottom: "1px solid #1b2030",
  flexShrink: 0,
};
const modalClose: React.CSSProperties = {
  border: "1px solid #2a3344",
  background: "#1a1f2b",
  color: "#cbd5e1",
  borderRadius: 6,
  width: 30,
  height: 30,
  cursor: "pointer",
  fontSize: 14,
  flexShrink: 0,
};
const modalPre: React.CSSProperties = {
  margin: 0,
  padding: "14px 18px",
  background: "#070a11",
  color: "#9ca3af",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  flex: 1,
  overflow: "auto",
};

"use client";

/**
 * /admin/alerts/:id — everything about one alert: full CAP content (every
 * <info> block with translations, areas, parameters), the message's lifecycle
 * chain (what it updated, what updated it), when the director aired it (from
 * the as-run log, linking into /admin/runs/:id), and the raw feed payload.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import AlertInfoBlock from "../../../../components/admin/AlertInfoBlock";
import {
  alertHazard,
  getAlertDetail,
  primaryInfo,
  severityColor,
  severityLabel,
  type AlertDetail,
} from "../../../../lib/alerts";
import { hazardMeta } from "../../../../lib/hazard";
import { fmtDuration } from "../../../../lib/airlog";

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const res = await getAlertDetail(id);
    if (!res) setMissing(true);
    else setDetail(res);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!detail) {
    return (
      <AdminPageShell title="Alert" crumbs={[{ href: "/admin/alerts", label: "Weather alerts" }, { label: "…" }]}>
        <div style={{ color: "#8b95a7" }}>{missing ? "No such alert." : "Loading…"}</div>
      </AdminPageShell>
    );
  }

  const { alert, chain, aired } = detail;
  const info = primaryInfo(alert);
  const h = hazardMeta(alertHazard(alert));
  const rank = alert.maxSeverityRank;

  return (
    <AdminPageShell
      title={`${h.icon} ${info?.event ?? "Alert"}`}
      maxWidth={1100}
      crumbs={[{ href: "/admin/alerts", label: "Weather alerts" }, { label: alert.identifier }]}
      description={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            title={severityLabel(rank)}
            style={{
              padding: "1px 9px",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 12,
              color: "#0a0e16",
              background: severityColor(rank),
            }}
          >
            {rank} · {severityLabel(rank)}
          </span>
          <span style={{ color: h.color }}>{h.label}</span>
          <span style={sourceChip}>{alert.source}</span>
          <span>{alert.msgType}</span>
          <span style={{ color: alert.active ? "#86efac" : "#8b95a7" }}>{alert.active ? "active" : "inactive"}</span>
        </span>
      }
      actions={
        <button type="button" onClick={reload} style={primary}>
          Refresh
        </button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {/* Message lifecycle / identity */}
        <div style={card}>
          <div style={cardLabel}>Message</div>
          <table style={{ fontSize: 13, borderCollapse: "collapse", marginTop: 8, width: "100%" }}>
            <tbody>
              {[
                ["Identifier", alert.identifier],
                ["Sender", alert.sender || "—"],
                ["Sent", fmtTime(alert.sent)],
                ["Status", `${alert.status}${alert.scope ? ` · ${alert.scope}` : ""}`],
                ["Ingested", fmtTime(alert.ingestedAt)],
                ["Expires", fmtTime(alert.expiresAt)],
                ["References", alert.references?.length ? `${alert.references.length} message(s)` : "none"],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ color: "#5b6478", padding: "3px 14px 3px 0", whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                  <td style={{ color: "#cbd5e1", padding: "3px 0", wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* As-run history: every director cut that aired this alert. */}
        <div style={card}>
          <div style={cardLabel}>On air ({aired.length})</div>
          {aired.length === 0 && (
            <div style={{ color: "#5b6478", fontSize: 13, marginTop: 8 }}>
              The director hasn&apos;t aired this alert (or it aired before as-run logging).
            </div>
          )}
          {aired.map((e) => (
            <div key={e.id} style={{ borderTop: "1px solid #121622", padding: "7px 0", fontSize: 13 }}>
              <Link href={`/admin/runs/${e.runId}`} style={{ color: "#60a5fa" }}>
                {fmtTime(e.startedAt)}
              </Link>
              <span style={{ color: "#8b95a7" }}>
                {" "}
                · shot #{e.seq}
                {e.actualMs != null ? ` · ${fmtDuration(e.actualMs)} on screen` : " · on air"}
                {e.breaking ? " · ⚡ breaking" : ""}
                {e.endReason === "skipped" ? " · skipped early" : ""}
              </span>
            </div>
          ))}
        </div>

        {/* CAP lifecycle chain */}
        <div style={card}>
          <div style={cardLabel}>Update chain ({chain.length})</div>
          {chain.length <= 1 && (
            <div style={{ color: "#5b6478", fontSize: 13, marginTop: 8 }}>No related updates — a single message so far.</div>
          )}
          {chain.length > 1 &&
            chain.map((c) => {
              const current = c.id === alert.id;
              return (
                <div key={c.id} style={{ borderTop: "1px solid #121622", padding: "7px 0", fontSize: 13 }}>
                  <span style={{ ...msgChip, ...(current ? { borderColor: "#2563eb", color: "#93c5fd" } : {}) }}>{c.msgType}</span>{" "}
                  {current ? (
                    <span style={{ color: "#e2e8f0" }}>{fmtTime(c.sent)} (this message)</span>
                  ) : (
                    <Link href={`/admin/alerts/${c.id}`} style={{ color: "#60a5fa" }}>
                      {fmtTime(c.sent)}
                    </Link>
                  )}
                  <span style={{ color: "#8b95a7" }}>
                    {" "}
                    · sev {c.maxSeverityRank}
                    {c.active ? " · active" : ""}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {/* Full CAP content */}
      {alert.info.map((inf, i) => (
        <AlertInfoBlock key={i} info={inf} index={i} />
      ))}

      {/* Raw feed payload, for debugging adapters. */}
      <details style={{ marginTop: 16 }}>
        <summary style={{ color: "#8b95a7", cursor: "pointer", fontSize: 13 }}>Raw document</summary>
        <pre style={rawPre}>{JSON.stringify(alert, null, 2)}</pre>
      </details>
    </AdminPageShell>
  );
}

const card: React.CSSProperties = {
  padding: 14,
  borderRadius: 8,
  border: "1px solid #1b2030",
  background: "#0c111c",
};
const cardLabel: React.CSSProperties = {
  color: "#8b95a7",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const sourceChip: React.CSSProperties = {
  padding: "1px 8px",
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 700,
  background: "#1b2030",
  color: "#cbd5e1",
};
const msgChip: React.CSSProperties = {
  display: "inline-block",
  padding: "0 7px",
  borderRadius: 9,
  fontSize: 11,
  fontWeight: 700,
  border: "1px solid #2a3344",
  color: "#8b95a7",
};
const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
const rawPre: React.CSSProperties = {
  marginTop: 8,
  padding: "12px 14px",
  background: "#070a11",
  color: "#9aa7bd",
  fontSize: 12,
  lineHeight: 1.5,
  borderRadius: 6,
  overflowX: "auto",
};

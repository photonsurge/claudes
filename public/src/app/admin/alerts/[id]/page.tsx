"use client";

/**
 * /admin/alerts/:id — everything about one alert: full CAP content (every
 * <info> block with translations, areas, parameters), the message's lifecycle
 * chain (what it updated, what updated it), when the director aired it (from
 * the as-run log, linking into /admin/runs/:id), and the raw feed payload.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import AlertInfoBlock from "../../../../components/admin/AlertInfoBlock";
import ImageLightbox, { type LightboxImage } from "../../../../components/admin/ImageLightbox";
import Sparkline from "../../../../components/Sparkline";
import GlobeView, { type GlobeHandle } from "../../../../components/GlobeView";
import {
  alertHazard,
  alertLocationLabels,
  alertsToFeatures,
  getAlertDetail,
  primaryInfo,
  severityColor,
  severityLabel,
  type AlertDetail,
} from "../../../../lib/alerts";
import { alertBbox } from "../../../../lib/alertGroups";
import { hazardMeta } from "../../../../lib/hazard";
import { fmtDuration } from "../../../../lib/airlog";

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

/** A small glyph per timeline beat type. */
const beatGlyph = (type: string): string => {
  switch (type) {
    case "ISSUED":
      return "🟢";
    case "SEVERITY_CHANGED":
      return "⚠️";
    case "AREA_CHANGED":
      return "📐";
    case "TEXT_CHANGED":
      return "📝";
    case "INSTRUCTION_CHANGED":
      return "📋";
    case "START_TIME_CHANGED":
      return "🕒";
    case "EXPIRY_CHANGED":
      return "⏳";
    case "CANCELLED":
      return "🚫";
    case "ENDED":
      return "⚫";
    default:
      return "🔄";
  }
};

export default function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const globe = useRef<GlobeHandle | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const res = await getAlertDetail(id);
    if (!res) setMissing(true);
    else setDetail(res);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Location preview — the alert's own CAP area polygon(s) on the shared globe,
  // framed to their bounding box. Mirrors the country/city "Location preview".
  const alertDoc = detail?.alert ?? null;
  const features = useMemo(() => (alertDoc ? alertsToFeatures([alertDoc]) : []), [alertDoc]);
  const bbox = useMemo(() => (alertDoc ? alertBbox(alertDoc) : null), [alertDoc]);
  const previewState = useMemo(
    () =>
      bbox
        ? {
            ...DEFAULT_CONTROL_STATE,
            activeVariable: null,
            showWind: false,
            showCities: false,
            showAlerts: true, // alertsLayer clones with visible=showAlerts
            camera: {
              center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] as [number, number],
              zoom: 4,
            },
          }
        : null,
    [bbox],
  );
  const pulseAt = useMemo<[number, number] | null>(
    () => alertRepPoint(features[0]?.geometry) ?? null,
    [features],
  );

  // Frame the alert's footprint once its geometry lands.
  useEffect(() => {
    if (bbox) globe.current?.fitBounds(bbox);
  }, [bbox]);

  if (!detail) {
    return (
      <AdminPageShell title="Alert" crumbs={[{ href: "/admin/alerts", label: "Weather alerts" }, { label: "…" }]}>
        <div style={{ color: "#8b95a7" }}>{missing ? "No such alert." : "Loading…"}</div>
      </AdminPageShell>
    );
  }

  const { alert, chain, aired, timeline, series, resources, snapshots } = detail;
  const info = primaryInfo(alert);
  const h = hazardMeta(alertHazard(alert));
  const rank = alert.maxSeverityRank;
  const location = alertLocationLabels(alert);

  return (
    <AdminPageShell
      title={`${h.icon} ${info?.event ?? "Alert"}`}
      maxWidth={1100}
      crumbs={[{ href: "/admin/alerts", label: "Weather alerts" }, { label: alert.identifier }]}
      description={
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 7 }}>
          <span aria-label="Alert location" style={locationLine}>
            <span>
              <span style={locationLabel}>Region</span> {location.region ?? "Unknown"}
            </span>
            <span aria-hidden style={{ color: "#323a4b" }}>·</span>
            <span>
              <span style={locationLabel}>Country</span> {location.country ?? "Unknown"}
            </span>
          </span>
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
        </span>
      }
      actions={
        <button type="button" onClick={reload} style={primary}>
          Refresh
        </button>
      }
    >
      {lightbox && <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {/* Change timeline — derived from in-place revisions + the CAP chain. */}
        <div style={card}>
          <div style={cardLabel}>Timeline ({timeline.length})</div>
          {timeline.length === 0 && (
            <div style={{ color: "#5b6478", fontSize: 13, marginTop: 8 }}>
              No changes recorded yet — just the initial bulletin.
            </div>
          )}
          {timeline.map((b, i) => (
            <div
              key={`${b.at}-${b.type}-${i}`}
              style={{ borderTop: "1px solid #121622", padding: "7px 0", fontSize: 13, display: "flex", gap: 8 }}
            >
              <span style={{ color: "#5b6478", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {fmtTime(b.at)}
              </span>
              <span aria-hidden style={{ width: 16, textAlign: "center" }}>
                {beatGlyph(b.type)}
              </span>
              <span style={{ color: "#e2e8f0" }}>
                {b.label}
                {typeof b.severityRank === "number" && (
                  <span style={{ marginLeft: 6, color: severityColor(b.severityRank) }}>
                    · {severityLabel(b.severityRank)}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>

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

      {/* Location — the alert's own CAP area(s) drawn on the shared globe. */}
      {previewState && features.length > 0 && (
        <div style={{ ...card, marginTop: 14, padding: 0, overflow: "hidden" }}>
          <div style={{ ...cardLabel, padding: "14px 14px 0" }}>
            Location{features.length > 1 ? ` · ${features.length} areas` : ""}
          </div>
          <div style={{ position: "relative", height: 420, marginTop: 12 }}>
            <GlobeView
              ref={globe}
              state={previewState}
              manifest={null}
              cities={[]}
              alerts={features}
              pulseAt={pulseAt}
              interactive
            />
          </div>
        </div>
      )}

      {/* Imagery, resources & trends — the P1/P2 satellite/camera/GDACS harvest. */}
      {(snapshots.length > 0 || resources.length > 0 || series.length > 0) && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>Imagery, resources &amp; trends</div>

          {snapshots.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
              {snapshots.slice(0, 12).map((s) => {
                const src = `/api/alerts/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`;
                const caption = `${s.kind}${s.distanceKm != null ? ` · ${Math.round(s.distanceKm)} km` : ""} · ${fmtTime(s.observationTime)}`;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`Open ${s.kind} image full screen`}
                    onClick={() => setLightbox({ src, alt: s.kind, caption })}
                    style={{ display: "block", width: 160, padding: 0, border: 0, color: "inherit", background: "none", textAlign: "left", cursor: "zoom-in" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={s.kind}
                      style={{ width: 160, height: 100, objectFit: "cover", borderRadius: 6, border: "1px solid #1b2030", background: "#070a11" }}
                    />
                    <div style={{ color: "#8b95a7", fontSize: 11, marginTop: 3 }}>
                      {caption}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {series.length > 0 && (
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              {series.map((m) => (
                <div key={m.metric} style={{ borderTop: "1px solid #121622", paddingTop: 8 }}>
                  <div style={{ color: "#cbd5e1", fontSize: 13 }}>
                    {m.metric} <span style={{ color: "#8b95a7" }}>· {m.latest}</span>
                  </div>
                  <Sparkline samples={m.samples} width={200} height={30} />
                </div>
              ))}
            </div>
          )}

          {resources.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ color: "#5b6478", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Resources</div>
              {resources.map((r) => (
                <div key={r.id ?? r.url} style={{ fontSize: 13, marginTop: 4 }}>
                  <span style={{ color: "#5b6478" }}>{r.kind}</span>{" "}
                  <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", wordBreak: "break-all" }}>
                    {r.description || r.url}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
const locationLine: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 9,
  flexWrap: "wrap",
  color: "#e2e8f0",
  fontSize: 14,
  fontWeight: 600,
};
const locationLabel: React.CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: "uppercase",
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

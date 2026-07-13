"use client";

/**
 * /admin/events/:id — one WatchedEvent's full dossier: the derived cross-source
 * timeline, contributing sources + revision history, external links (with match
 * method/score), harvested resources (attribution/licence + rebroadcast flag),
 * metric series (sparklines) and captured snapshots. The verification surface for
 * the whole acquisition pipeline.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import Sparkline from "../../../../components/Sparkline";
import { getEventDetail, eventStatusColor, type EventDetail } from "../../../../lib/events";

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

const beatGlyph = (type: string): string => {
  switch (type) {
    case "ISSUED":
      return "🟢";
    case "SOURCE_LINKED":
      return "🔗";
    case "SEVERITY_CHANGED":
      return "⚠️";
    case "AREA_CHANGED":
      return "📐";
    case "IMPACT_UPDATE":
      return "📊";
    case "PRODUCT_ADDED":
    case "MAP_ADDED":
    case "IMAGE_ADDED":
      return "🗺️";
    case "REPORT_ADDED":
      return "📰";
    case "GEOMETRY_REFINED":
      return "✏️";
    case "SNAPSHOT_CAPTURED":
      return "🛰️";
    case "CANCELLED":
      return "🚫";
    case "ENDED":
    case "CLOSED":
      return "⚫";
    default:
      return "🔄";
  }
};

const card: React.CSSProperties = {
  background: "#0f1420",
  border: "1px solid #1c2333",
  borderRadius: 10,
  padding: "14px 16px",
  marginBottom: 16,
};
const cardTitle: React.CSSProperties = { margin: "0 0 10px", fontSize: 14, color: "#c9d1e0", fontWeight: 600 };
const dim: React.CSSProperties = { color: "#8b95a7", fontSize: 12 };
const link: React.CSSProperties = { color: "#60a5fa", textDecoration: "none", wordBreak: "break-all" };

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<EventDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const res = await getEventDetail(id);
    if (!res) setMissing(true);
    else setD(res);
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (missing) {
    return (
      <AdminPageShell title="Event" crumbs={[{ href: "/admin/events", label: "Watched Events" }, { label: "—" }]}>
        <p style={{ color: "#f85149" }}>No such event.</p>
      </AdminPageShell>
    );
  }
  if (!d) {
    return (
      <AdminPageShell title="Event" crumbs={[{ href: "/admin/events", label: "Watched Events" }, { label: "…" }]}>
        <p style={dim}>Loading…</p>
      </AdminPageShell>
    );
  }

  const e = d.event;
  return (
    <AdminPageShell
      title={e.title || e.primarySourceId}
      description={
        <span>
          <span style={{ color: eventStatusColor(e.status), fontWeight: 600 }}>{e.status}</span> · {e.type} ·{" "}
          {e.primarySource}:{e.primarySourceId}
        </span>
      }
      crumbs={[{ href: "/admin/events", label: "Watched Events" }, { label: e.title || e.primarySourceId }]}
    >
      {/* Timeline */}
      <div style={card}>
        <h3 style={cardTitle}>Timeline ({d.timeline.length})</h3>
        {d.timeline.length === 0 ? (
          <p style={dim}>No beats yet.</p>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {d.timeline.map((b, i) => (
              <li key={i} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid #161c2b" }}>
                <span style={{ width: 22 }}>{beatGlyph(b.type)}</span>
                <span style={{ width: 130, ...dim }}>{fmtTime(b.at)}</span>
                <span style={{ flex: 1, fontSize: 13 }}>{b.label}</span>
                {b.source ? <span style={dim}>{b.source}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Snapshots */}
      {d.snapshots.length > 0 && (
        <div style={card}>
          <h3 style={cardTitle}>Snapshots ({d.snapshots.length})</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {d.snapshots.map((s) => (
              <a key={s.id} href={`/api/events/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/events/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`}
                  alt={s.kind}
                  style={{ width: 200, height: "auto", borderRadius: 6, border: "1px solid #1c2333", display: "block" }}
                />
                <span style={dim}>
                  {s.kind}
                  {s.layer ? ` · ${s.layer}` : ""} · {fmtTime(s.capturedAt)}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Series */}
      {d.series.length > 0 && (
        <div style={card}>
          <h3 style={cardTitle}>Metric series</h3>
          {d.series.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "4px 0" }}>
              <span style={{ width: 160, fontSize: 13 }}>
                {s.source}:{s.metric}
              </span>
              <Sparkline samples={s.samples} />
              <span style={dim}>latest {s.latest}</span>
            </div>
          ))}
        </div>
      )}

      {/* Resources */}
      {d.resources.length > 0 && (
        <div style={card}>
          <h3 style={cardTitle}>Resources ({d.resources.length})</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {d.resources.map((r) => (
              <li key={r.id} style={{ padding: "3px 0", fontSize: 13 }}>
                <span style={{ ...dim, marginRight: 6 }}>[{r.kind}]</span>
                <a href={r.url} target="_blank" rel="noreferrer" style={link}>
                  {r.title || r.url}
                </a>
                {r.attribution ? <span style={{ ...dim, marginLeft: 6 }}>— {r.attribution}</span> : null}
                {!r.rebroadcastSafe ? <span style={{ color: "#d29922", marginLeft: 6, fontSize: 11 }}>ref-only</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sources + links */}
      <div style={card}>
        <h3 style={cardTitle}>Sources ({d.sources.length})</h3>
        {d.sources.length === 0 ? (
          <p style={dim}>No contributing sources acquired yet.</p>
        ) : (
          d.sources.map((s) => (
            <div key={s.id} style={{ padding: "4px 0", fontSize: 13, borderBottom: "1px solid #161c2b" }}>
              <strong>{s.source}</strong> <span style={dim}>#{s.sourceEventId}</span> · changed {fmtTime(s.lastChangedAt)}{" "}
              <span style={dim}>hash {s.currentPayloadHash?.slice(0, 10)}</span>
            </div>
          ))
        )}
        {d.links.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {d.links.map((l) => (
              <div key={l.id} style={{ ...dim, padding: "2px 0" }}>
                🔗 {l.source}:{l.externalId} · {l.matchMethod}
                {l.matchScore != null ? ` (${l.matchScore})` : ""}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule */}
      {d.schedules.length > 0 && (
        <div style={card}>
          <h3 style={cardTitle}>Acquisition schedule</h3>
          {d.schedules.map((s) => (
            <div key={s.id} style={{ ...dim, padding: "2px 0" }}>
              {s.source} · every {s.intervalSeconds}s · next {fmtTime(String(s.nextCheckAt))} · failures {s.failureCount}
            </div>
          ))}
        </div>
      )}
    </AdminPageShell>
  );
}

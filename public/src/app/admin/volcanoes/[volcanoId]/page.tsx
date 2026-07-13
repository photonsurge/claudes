"use client";

/**
 * /admin/volcanoes/:volcanoId — the full dossier for one volcano: GVP status,
 * USGS alert/aviation colour, the official status timeline (the WatchedEvent it
 * was promoted to), this week's bulletin + parsed VEI/plume, and Wikipedia
 * enrichment. Mirrors /admin/alerts/:id. `:volcanoId` is the `gvp:<vnum>` key.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";
import AdminPageShell from "../../../../components/admin/AdminPageShell";

interface VolcanoDetail {
  volcano: Volcano;
  event: { id: string; status: string; startedAt: string } | null;
  timeline: EventTimelineBeat[];
}

const STATUS_COLOR: Record<string, string> = {
  erupting: "#ef4444",
  unrest: "#f97316",
  dormant: "#94a3b8",
};
const USGS_COLOR: Record<string, string> = {
  RED: "#ef4444",
  ORANGE: "#f97316",
  YELLOW: "#eab308",
  GREEN: "#34d399",
};

const fmtTime = (ms?: number | string): string => {
  if (ms == null || ms === "") return "—";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? String(ms) : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

/** A small glyph per volcano timeline-beat type. */
const beatGlyph = (type: string): string => {
  switch (type) {
    case "ISSUED":
      return "🟢";
    case "ALERT_LEVEL_CHANGED":
      return "⚠️";
    case "AVIATION_COLOR_CHANGED":
      return "✈️";
    case "ACTIVITY_CHANGED":
      return "📝";
    case "VEI_CHANGED":
      return "🌋";
    case "PLUME_CHANGED":
      return "💨";
    case "ENDED":
      return "⚫";
    default:
      return "🔄";
  }
};

export default function VolcanoDetailPage() {
  const { volcanoId } = useParams<{ volcanoId: string }>();
  const [detail, setDetail] = useState<VolcanoDetail | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    if (!volcanoId) return;
    const res = await fetch(`/api/admin/volcanoes/${encodeURIComponent(volcanoId)}`);
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setDetail(await res.json());
  }, [volcanoId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!detail) {
    return (
      <AdminPageShell title="Volcano" crumbs={[{ href: "/admin/volcanoes", label: "Volcanoes" }, { label: "…" }]}>
        <div style={{ color: "#8b95a7" }}>{missing ? "No such volcano." : "Loading…"}</div>
      </AdminPageShell>
    );
  }

  const { volcano: v, timeline } = detail;

  return (
    <AdminPageShell
      title={`🌋 ${v.name}`}
      maxWidth={1100}
      crumbs={[{ href: "/admin/volcanoes", label: "Volcanoes" }, { label: v.name }]}
      description={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: STATUS_COLOR[v.status] ?? "#cbd5e1", fontWeight: 700 }}>● {v.status}</span>
          {v.country && <span style={{ color: "#8b95a7" }}>{v.country}</span>}
          {v.usgsColorCode && (
            <span style={{ color: USGS_COLOR[v.usgsColorCode] ?? "#cbd5e1" }}>
              ● USGS {v.usgsColorCode}
              {v.usgsAlertLevel ? ` / ${v.usgsAlertLevel}` : ""}
            </span>
          )}
        </span>
      }
      actions={
        <button type="button" onClick={reload} style={primary}>
          Refresh
        </button>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
        {/* Official status timeline (the promoted WatchedEvent's beats). */}
        <div style={card}>
          <div style={cardLabel}>Status timeline ({timeline.length})</div>
          {timeline.length === 0 && (
            <div style={{ color: "#5b6478", fontSize: 13, marginTop: 8 }}>
              No status changes recorded yet{detail.event ? "" : " — not promoted (needs EVENTS_UNIFIED_ENABLED)"}.
            </div>
          )}
          {timeline
            .slice()
            .reverse()
            .map((b, i) => (
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
                <span style={{ color: "#e2e8f0" }}>{b.label}</span>
              </div>
            ))}
        </div>

        {/* Identity / facts. */}
        <div style={card}>
          <div style={cardLabel}>Volcano</div>
          <table style={{ fontSize: 13, borderCollapse: "collapse", marginTop: 8, width: "100%" }}>
            <tbody>
              {(
                [
                  ["GVP id", v.id],
                  ["Type", v.volcanoType ?? "—"],
                  ["Elevation", v.elevationM != null ? `${v.elevationM.toLocaleString()} m` : "—"],
                  ["Last known eruption", v.lastEruptionYear != null ? String(v.lastEruptionYear) : "—"],
                  ["This week's report", `${fmtTime(v.lastDate)}${v.reportDateRange ? ` (${v.reportDateRange})` : ""}`],
                  ["Tracked since", fmtTime(v.firstDate)],
                  ["Coordinates", `${v.lat.toFixed(3)}, ${v.lng.toFixed(3)}`],
                ] as [string, string][]
              ).map(([k, val]) => (
                <tr key={k}>
                  <td style={{ color: "#5b6478", padding: "3px 14px 3px 0", whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {k}
                  </td>
                  <td style={{ color: "#cbd5e1", padding: "3px 0", wordBreak: "break-all" }}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* USGS notice, when present. */}
        {v.usgsColorCode && (
          <div style={card}>
            <div style={cardLabel}>USGS notice</div>
            <div style={{ color: USGS_COLOR[v.usgsColorCode] ?? "#cbd5e1", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
              ● {v.usgsColorCode}
              {v.usgsAlertLevel ? ` / ${v.usgsAlertLevel}` : ""}
            </div>
            {v.usgsNoticeSynopsis && (
              <p style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.45, margin: "6px 0 0" }}>{v.usgsNoticeSynopsis}</p>
            )}
            {v.usgsUpdatedAt && <div style={{ color: "#5b6478", fontSize: 12, marginTop: 6 }}>Updated {fmtTime(v.usgsUpdatedAt)}</div>}
            {v.usgsNoticeUrl && (
              <a href={v.usgsNoticeUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 13, display: "inline-block", marginTop: 6 }}>
                USGS notice ↗
              </a>
            )}
          </div>
        )}
      </div>

      {/* This week's bulletin + parsed facts. */}
      {v.latestReport && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>Latest bulletin</div>
          <p style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.5, margin: "8px 0 0" }}>{v.latestReport}</p>
          {(v.reportVei != null || v.reportPlumeHeightM != null) && (
            <div style={{ color: "#5b6478", fontSize: 12, marginTop: 6 }}>
              Parsed:{" "}
              {[
                v.reportVei != null ? `VEI ${v.reportVei}` : undefined,
                v.reportPlumeHeightM != null ? `plume ${v.reportPlumeHeightM.toLocaleString()} m` : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </div>
      )}

      {/* Wikipedia enrichment. */}
      {(v.wikiPhoto || v.wikiThumb || v.wikiExtract) && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>About</div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
            {(v.wikiPhoto || v.wikiThumb) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={v.wikiPhoto || v.wikiThumb}
                alt=""
                style={{ width: 240, height: 150, objectFit: "cover", borderRadius: 6, background: "#070a11" }}
              />
            )}
            {v.wikiExtract && (
              <p style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.5, margin: 0, flex: "1 1 260px" }}>{v.wikiExtract}</p>
            )}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
            {v.wikiTitle && (
              <a
                href={`https://en.wikipedia.org/wiki/${encodeURIComponent(v.wikiTitle.replace(/ /g, "_"))}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#60a5fa", fontSize: 13 }}
              >
                Wikipedia ↗
              </a>
            )}
            {v.sourceUrl && (
              <a href={v.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 13 }}>
                GVP report ↗
              </a>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <Link href="/admin/volcanoes" style={{ color: "#60a5fa", fontSize: 13 }}>
          ← All volcanoes
        </Link>
      </div>
    </AdminPageShell>
  );
}

const card: React.CSSProperties = { padding: 14, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" };
const cardLabel: React.CSSProperties = { color: "#8b95a7", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 };
const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};

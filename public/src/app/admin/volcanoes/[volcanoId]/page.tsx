"use client";

/**
 * /admin/volcanoes/:volcanoId — the full dossier for one volcano: GVP status,
 * USGS alert/aviation colour, the official status timeline (the WatchedEvent it
 * was promoted to), this week's bulletin + parsed VEI/plume, and Wikipedia
 * enrichment. Mirrors /admin/alerts/:id. `:volcanoId` is the `gvp:<vnum>` key.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "next/navigation";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";
import type { Cam } from "@photonsurge/shared/cams/types";
import type { EventSnapshotMeta } from "@photonsurge/shared/db/event-snapshot-repo";
import type { VolcanoMedia } from "@photonsurge/shared/volcanoes/media";
import type { VolcanoCamera } from "@photonsurge/shared/volcanoes/media";
import type { iVolcanoMediaSource } from "@photonsurge/shared/db/volcano-media-source-model";
import type { VolcanoEruption } from "@photonsurge/shared/db/volcano-eruption-repo";
import { formatGvpDate } from "@photonsurge/shared/volcanoes/gvp-wfs";
import AdminPageShell from "../../../../components/admin/AdminPageShell";

/** Render a stored eruption's fuzzy start/end for humans (BCE, "?", unknown month/day). */
const eruptionDate = (e: VolcanoEruption, side: "start" | "end"): string => {
  const year = side === "start" ? e.startYear : e.endYear;
  if (year === undefined) return "—";
  return formatGvpDate({
    year,
    month: side === "start" ? e.startMonth : e.endMonth,
    day: side === "start" ? e.startDay : e.endDay,
    precision: (side === "start" ? e.startPrecision : e.endPrecision) ?? "year",
    modifier: side === "start" ? e.startModifier : e.endModifier,
  });
};

/** VEI 0-7 → a colour ramp (green → red), mirroring the alert palette. */
const VEI_COLOR = ["#64748b", "#34d399", "#a3e635", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#b91c1c"];

/**
 * GVP's `StartEvidenceMethod` = HOW the eruption's start date was established, and
 * it's only interesting for prehistoric eruptions (radiocarbon, tephrochronology,
 * ice cores, varve counts). 6,468 of 11,089 rows — and 86% of eruptions since 1900
 * — are just "Observations: Reported", i.e. someone watched it happen. So strip the
 * category prefix and dim the boring case rather than repeating it down the column.
 */
const datedBy = (evidence?: string): { text: string; dim: boolean } => {
  if (!evidence || evidence === "Uncertain") return { text: "—", dim: true };
  const [category, method] = evidence.split(":").map((s) => s.trim());
  if (category === "Observations") return { text: method === "Reported" ? "observed" : method.toLowerCase(), dim: true };
  return { text: method ?? category, dim: false };
};

interface VolcanoDetail {
  volcano: Volcano;
  event: { id: string; status: string; startedAt: string } | null;
  timeline: EventTimelineBeat[];
  cams: Cam[];
  snapshots: EventSnapshotMeta[];
  media: VolcanoMedia[];
  volcanoCameras: VolcanoCamera[];
  mediaSources: iVolcanoMediaSource[];
  eruptions: VolcanoEruption[];
}

const snapSrc = (s: EventSnapshotMeta) => `/api/events/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`;

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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [externalPreview, setExternalPreview] = useState<{ src: string; title: string; meta?: string } | null>(null);
  const [busyCam, setBusyCam] = useState<string | null>(null);

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

  /** Switch one camera on/off. Reuses the existing admin cam route; reloads so the
   *  on/off counts and ordering reflect the change. */
  const toggleCam = useCallback(
    async (camId: string, status: "active" | "inactive") => {
      setBusyCam(camId);
      try {
        await fetch(`/api/admin/cams/${encodeURIComponent(camId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        await reload();
      } finally {
        setBusyCam(null);
      }
    },
    [reload],
  );

  useEffect(() => {
    if (lightboxIndex == null && !externalPreview) return;
    const count = detail?.media?.filter((item) => item.type !== "VIDEO" && (item.assetRef || item.imageUrl)).length ?? 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setLightboxIndex(null); setExternalPreview(null); }
      if (event.key === "ArrowLeft" && count) setLightboxIndex((index) => index == null ? null : (index - 1 + count) % count);
      if (event.key === "ArrowRight" && count) setLightboxIndex((index) => index == null ? null : (index + 1) % count);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [detail?.media?.length, lightboxIndex, externalPreview]);

  if (!detail) {
    return (
      <AdminPageShell title="Volcano" crumbs={[{ href: "/admin/volcanoes", label: "Volcanoes" }, { label: "…" }]}>
        <div style={{ color: "#8b95a7" }}>{missing ? "No such volcano." : "Loading…"}</div>
      </AdminPageShell>
    );
  }

  const { volcano: v, timeline, cams } = detail;
  const snapshots = detail.snapshots ?? [];
  const eruptions = detail.eruptions ?? [];
  const camsOn = (cams ?? []).filter((c) => c.status === "active");
  const camsOff = (cams ?? []).filter((c) => c.status !== "active");
  const veiKnown = eruptions.filter((e) => e.vei !== undefined);
  const largestVei = veiKnown.length ? Math.max(...veiKnown.map((e) => e.vei!)) : undefined;
  const since1900 = eruptions.filter((e) => e.startYear >= 1900).length;
  const timelapses = snapshots.filter((s) => s.kind === "render");
  const capturedFrames = snapshots.filter((s) => s.kind === "camera").slice(0, 24);
  const media = detail.media ?? [];
  const mediaSrc = (item: VolcanoMedia) => item.assetRef
    ? `/api/volcanoes/media/${encodeURIComponent(item.assetRef)}?v=${encodeURIComponent(item.contentHash ?? item.acquiredAt.toString())}`
    : item.imageUrl;
  const lightboxMedia = media.filter((item) => item.type !== "VIDEO" && Boolean(mediaSrc(item)));
  const mediaGroups = [...new Map(media.map((item) => {
    const key = `${item.source}:${item.type}`;
    return [key, media.filter((candidate) => candidate.source === item.source && candidate.type === item.type)] as const;
  })).entries()];
  const volcanoCameras = detail.volcanoCameras ?? [];
  const usedSourceIds = new Set([
    ...media.map((item) => item.source),
    ...volcanoCameras.map((camera) => camera.source),
  ]);
  const mediaSources = (detail.mediaSources ?? []).filter((source) => usedSourceIds.has(source.source));

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

        {/* Official (non-USGS) observatory status, e.g. GeoNet VAL. */}
        {v.officialAlertLevelRaw && (
          <div style={card}>
            <div style={cardLabel}>Official status</div>
            <div style={{ color: "#f59e0b", fontSize: 13, fontWeight: 600, marginTop: 8 }}>
              {(v.officialSource ?? "").toUpperCase()} {v.officialAlertScheme} · level {v.officialAlertLevelRaw}
              {v.officialAlertLevelNormalized ? ` (${v.officialAlertLevelNormalized})` : ""}
            </div>
            {v.officialActivity && (
              <p style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.45, margin: "6px 0 0" }}>{v.officialActivity}</p>
            )}
            {v.officialUpdatedAt && (
              <div style={{ color: "#5b6478", fontSize: 12, marginTop: 6 }}>Updated {fmtTime(v.officialUpdatedAt)}</div>
            )}
          </div>
        )}

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

      {/* Official monitoring cameras — live latest still, each with an ON/OFF
          switch. "Some aren't great": a bad angle is a per-CAMERA judgement, so the
          toggle lives here. Switching one off stops it being captured, put on air,
          or counted — nothing auto-disables it back on, and nothing auto-decides
          quality for you. Active cameras sort first; anything the registry lost
          (the orphaned INGV archive rows) shows as OFF and can be purged wholesale
          from /admin/jobs → "Purge orphaned volcano cameras". */}
      {cams && cams.length > 0 && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>
            Cameras ({camsOn.length} on{camsOff.length > 0 && <span style={{ color: "#5b6478" }}> · {camsOff.length} off</span>})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
            {[...camsOn, ...camsOff].map((c) => {
              const on = c.status === "active";
              return (
                <div key={c.camId} style={{ width: 220, opacity: on ? 1 : 0.42 }}>
                  <button
                    type="button"
                    onClick={() => c.imageUrl && setExternalPreview({ src: c.imageUrl, title: c.title, meta: c.attribution?.provider })}
                    style={{ display: "block", width: 220, color: "inherit", textAlign: "left", padding: 0, border: 0, background: "transparent", cursor: c.imageUrl ? "zoom-in" : "default" }}
                  >
                    {c.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.imageUrl}
                        alt={c.title}
                        style={{
                          width: 220,
                          height: 138,
                          objectFit: "cover",
                          borderRadius: 6,
                          border: `1px solid ${on ? "#1b2030" : "#3a2020"}`,
                          background: "#070a11",
                          filter: on ? undefined : "grayscale(1)",
                        }}
                      />
                    )}
                    <div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 4, wordBreak: "break-all" }}>{c.title}</div>
                    {c.attribution?.provider && (
                      <div style={{ color: "#5b6478", fontSize: 11 }}>{c.attribution.provider}</div>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busyCam === c.camId}
                    onClick={() => toggleCam(c.camId, on ? "inactive" : "active")}
                    style={{
                      marginTop: 5,
                      padding: "3px 10px",
                      borderRadius: 5,
                      fontSize: 11,
                      cursor: busyCam === c.camId ? "wait" : "pointer",
                      border: `1px solid ${on ? "#1f6f43" : "#4b5563"}`,
                      background: on ? "#0f2d1e" : "#1a1f2b",
                      color: on ? "#34d399" : "#8b95a7",
                    }}
                  >
                    {busyCam === c.camId ? "…" : on ? "● On" : "○ Off"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Worker-captured camera history — timelapse loops + recent archived frames
          (the "earlier today / this week" observation record). Needs the capture
          job (VOLCANO_CAM_SNAPSHOT_ENABLED) to have run. */}
      {(timelapses.length > 0 || capturedFrames.length > 0) && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>Camera history ({snapshots.length})</div>
          {timelapses.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
              {timelapses.map((s) => (
                <figure key={s.id} style={{ margin: 0, width: 320 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={snapSrc(s)}
                    alt="timelapse"
                    style={{ width: 320, height: 180, objectFit: "cover", borderRadius: 6, border: "1px solid #1b2030", background: "#070a11" }}
                  />
                  <figcaption style={{ color: "#5b6478", fontSize: 11, marginTop: 3 }}>
                    ▶ timelapse · {fmtTime(s.observationTime)}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {capturedFrames.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {capturedFrames.map((s) => (
                <a key={s.id} href={snapSrc(s)} target="_blank" rel="noreferrer" title={fmtTime(s.observationTime)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={snapSrc(s)}
                    alt="frame"
                    style={{ width: 128, height: 80, objectFit: "cover", borderRadius: 4, border: "1px solid #1b2030", background: "#070a11" }}
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {media.length > 0 && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>Official media ({media.length})</div>
          {mediaGroups.map(([group, items]) => <section key={group} style={{ marginTop: 14 }}>
            <div style={{ color: "#7f8da3", fontSize: 11, fontWeight: 700, letterSpacing: .5, marginBottom: 7 }}>
              {items[0].source} · {items[0].type} ({items.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {items.map((item) => {
              const src = mediaSrc(item);
              const lightboxItemIndex = lightboxMedia.findIndex((candidate) => candidate.id === item.id);
              return (
                <figure key={item.id} style={{ margin: 0, minWidth: 0 }}>
                  {src && item.type !== "VIDEO" && (
                    <button type="button" onClick={() => { if (lightboxItemIndex >= 0) setLightboxIndex(lightboxItemIndex); }} aria-label={`Open ${item.title ?? item.caption ?? item.type}`}
                      style={{ display: "block", width: "100%", padding: 0, border: 0, background: "transparent", cursor: "zoom-in" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={item.title ?? item.caption ?? item.type}
                        style={{ width: "100%", height: 145, objectFit: "cover", borderRadius: 6, border: "1px solid #1b2030", background: "#070a11", display: "block" }} />
                    </button>
                  )}
                  <figcaption style={{ marginTop: 5 }}>
                    <div style={{ color: "#cbd5e1", fontSize: 12 }}>{item.title ?? item.caption ?? item.type}</div>
                    <div style={{ color: "#5b6478", fontSize: 11 }}>
                      {item.source} · {item.type} · {fmtTime(item.observedAt?.toString() ?? item.acquiredAt.toString())}
                    </div>
                    <div style={{ color: item.reuseAllowed ? "#34d399" : "#f59e0b", fontSize: 10 }}>
                      {item.licence ?? "VERIFY"}{item.reuseAllowed ? " · reusable" : " · internal review only"}
                    </div>
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 11 }}>Source ↗</a>
                  </figcaption>
                </figure>
              );
            })}
            </div>
          </section>)}
        </div>
      )}

      {(mediaSources.length > 0 || volcanoCameras.length > 0) && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>Monitoring sources ({mediaSources.length})</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 10, marginTop: 10 }}>
            {mediaSources.map((source) => {
              const sourceMedia = media.filter((item) => item.source === source.source);
              const sourceCameras = volcanoCameras.filter((camera) => camera.source === source.source);
              return (
                <div key={source.source} style={{ padding: 11, border: "1px solid #1b2030", borderRadius: 7, background: "#090e18" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ color: "#dbe5f3", fontSize: 13 }}>{source.name}</strong>
                    <span style={{ color: source.enabled ? "#34d399" : "#64748b", fontSize: 10 }}>{source.enabled ? "ENABLED" : "DISABLED"}</span>
                  </div>
                  <div style={{ color: "#7f8a9d", fontSize: 11, marginTop: 5 }}>
                    {sourceCameras.length} camera{sourceCameras.length === 1 ? "" : "s"} · {sourceMedia.length} archived item{sourceMedia.length === 1 ? "" : "s"}
                  </div>
                  <div style={{ color: source.defaultReuseAllowed ? "#34d399" : "#f59e0b", fontSize: 11, marginTop: 3 }}>
                    {source.defaultLicence ?? "VERIFY"} · {source.defaultReuseAllowed ? "default reusable" : "review before reuse"}
                  </div>
                  {source.attribution && <div style={{ color: "#667085", fontSize: 10, marginTop: 3 }}>{source.attribution}</div>}
                  {source.lastDiscoveredAt && <div style={{ color: "#566174", fontSize: 10, marginTop: 3 }}>Registry checked {fmtTime(source.lastDiscoveredAt.toString())}</div>}
                  {source.lastError && <div style={{ color: "#ef8f8f", fontSize: 10, marginTop: 3 }}>Last error: {source.lastError}</div>}
                  <a href={source.registryUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 11, display: "inline-block", marginTop: 5 }}>Source registry ↗</a>
                </div>
              );
            })}
          </div>
          {volcanoCameras.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ color: "#93a4ba", fontSize: 12, cursor: "pointer" }}>Camera registry details ({volcanoCameras.length})</summary>
              <div style={{ overflowX: "auto", marginTop: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr>{["Source", "Camera", "Mode", "Coordinates", "Bearing", "Upstream time", "Rights"].map((label) =>
                    <th key={label} style={{ textAlign: "left", color: "#64748b", padding: "5px 8px", borderBottom: "1px solid #1b2030" }}>{label}</th>)}</tr></thead>
                  <tbody>{volcanoCameras.map((camera) => (
                    <tr key={camera.id}>
                      <td style={sourceCell}>{camera.source}</td>
                      <td style={sourceCell}><a href={camera.detailUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>{camera.name}</a><div style={{ color: "#4f5b6d" }}>{camera.sourceCameraId}</div></td>
                      <td style={sourceCell}>{camera.mode}</td>
                      <td style={sourceCell}>{camera.latitude != null && camera.longitude != null ? `${camera.latitude.toFixed(4)}, ${camera.longitude.toFixed(4)}` : "—"}</td>
                      <td style={sourceCell}>{camera.bearing != null ? `${camera.bearing}°` : "—"}</td>
                      <td style={sourceCell}>{camera.upstreamTimestamp ?? "—"}</td>
                      <td style={sourceCell}>{camera.licence ?? "VERIFY"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      {/* Eruption history — a CATALOG fact, so it renders for every volcano
          (dormant included), independent of any WatchedEvent. This is Band 2 of
          the planned per-volcano timeline. Empty until `seedEruptions` has run. */}
      {eruptions.length > 0 && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>
            Eruption history ({eruptions.length})
          </div>
          <div style={{ color: "#8b95a7", fontSize: 12, margin: "6px 0 10px" }}>
            {since1900} since 1900
            {largestVei !== undefined && <> · largest VEI {largestVei}</>}
            {" · oldest "}
            {eruptionDate(eruptions[eruptions.length - 1], "start")}
          </div>
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table style={{ fontSize: 13, borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ color: "#5b6478", textAlign: "left" }}>
                  <th style={{ padding: "4px 10px 4px 0", fontWeight: 500 }}>Start</th>
                  <th style={{ padding: "4px 10px 4px 0", fontWeight: 500 }}>End</th>
                  <th style={{ padding: "4px 10px 4px 0", fontWeight: 500 }}>VEI</th>
                  <th
                    style={{ padding: "4px 10px 4px 0", fontWeight: 500 }}
                    title="How GVP established the start date — only really meaningful for prehistoric eruptions"
                  >
                    Dated by
                  </th>
                </tr>
              </thead>
              <tbody>
                {eruptions.map((e) => (
                  <tr key={e.eruptionNumber} style={{ borderTop: "1px solid #121622" }}>
                    <td style={{ padding: "5px 10px 5px 0", color: "#e2e8f0", whiteSpace: "nowrap" }}>
                      {eruptionDate(e, "start")}
                      {!e.confirmed && <span style={{ color: "#5b6478" }} title="Uncertain eruption"> ?</span>}
                    </td>
                    <td style={{ padding: "5px 10px 5px 0", color: "#8b95a7", whiteSpace: "nowrap" }}>
                      {eruptionDate(e, "end")}
                    </td>
                    <td style={{ padding: "5px 10px 5px 0" }}>
                      {e.vei !== undefined ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span
                            aria-hidden
                            style={{
                              display: "inline-block",
                              width: Math.max(6, (e.vei + 1) * 7),
                              height: 8,
                              borderRadius: 2,
                              background: VEI_COLOR[e.vei] ?? "#64748b",
                            }}
                          />
                          <span style={{ color: "#cbd5e1" }}>{e.vei}</span>
                        </span>
                      ) : (
                        <span style={{ color: "#5b6478" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "5px 0", color: datedBy(e.startEvidence).dim ? "#3f4757" : "#8b95a7" }}>
                      {datedBy(e.startEvidence).text}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Wikipedia enrichment. */}
      {(v.wikiPhoto || v.wikiThumb || v.wikiExtract) && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={cardLabel}>About</div>
          <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
            {(v.wikiPhoto || v.wikiThumb) && (
              // eslint-disable-next-line @next/next/no-img-element
              <button type="button" onClick={() => setExternalPreview({ src: v.wikiPhoto || v.wikiThumb!, title: `${v.name} reference image`, meta: "Wikipedia / Wikimedia" })}
                style={{ padding: 0, border: 0, background: "transparent", cursor: "zoom-in" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={v.wikiPhoto || v.wikiThumb} alt=""
                  style={{ width: 240, height: 150, objectFit: "cover", borderRadius: 6, background: "#070a11", display: "block" }} />
              </button>
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

      {lightboxIndex != null && lightboxMedia[lightboxIndex] && (() => {
        const item = lightboxMedia[lightboxIndex];
        const src = mediaSrc(item);
        return createPortal(
          <div role="dialog" aria-modal="true" aria-label={item.title ?? item.caption ?? "Volcano media"}
            onMouseDown={(event) => { if (event.target === event.currentTarget) setLightboxIndex(null); }}
            style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(2,5,10,.94)", display: "grid",
              gridTemplateRows: "auto minmax(0, 1fr) auto", padding: 18, backdropFilter: "blur(8px)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ color: "#8b95a7", fontSize: 12 }}>{lightboxIndex + 1} / {lightboxMedia.length} · {item.source} · {item.type}</div>
              <button type="button" onClick={() => setLightboxIndex(null)} aria-label="Close lightbox"
                style={{ ...lightboxButton, fontSize: 22, width: 42 }}>×</button>
            </div>
            <div style={{ minHeight: 0, display: "grid", gridTemplateColumns: "52px minmax(0, 1fr) 52px", alignItems: "center", gap: 12 }}>
              <button type="button" onClick={() => setLightboxIndex((lightboxIndex - 1 + lightboxMedia.length) % lightboxMedia.length)} aria-label="Previous image"
                style={lightboxButton}>‹</button>
              {src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={item.title ?? item.caption ?? item.type}
                  style={{ display: "block", maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", margin: "auto",
                    objectFit: "contain", borderRadius: 8, boxShadow: "0 18px 70px rgba(0,0,0,.65)" }} />
              )}
              <button type="button" onClick={() => setLightboxIndex((lightboxIndex + 1) % lightboxMedia.length)} aria-label="Next image"
                style={lightboxButton}>›</button>
            </div>
            <div style={{ width: "min(900px, 100%)", margin: "12px auto 0", textAlign: "center" }}>
              <div style={{ color: "#f1f5f9", fontSize: 15, fontWeight: 600 }}>{item.title ?? item.caption ?? item.type}</div>
              {item.title && item.caption && <div style={{ color: "#aab3c2", fontSize: 13, marginTop: 4 }}>{item.caption}</div>}
              <div style={{ color: "#6f7a8d", fontSize: 11, marginTop: 6 }}>
                {fmtTime(item.observedAt?.toString() ?? item.acquiredAt.toString())} · {item.attribution ?? item.source} · {item.licence ?? "VERIFY"}
                {item.reuseAllowed ? " · reusable" : " · internal review only"}
              </div>
              <div style={{ color: "#556174", fontSize: 10, marginTop: 5, overflowWrap: "anywhere" }}>
                {item.sourceMediaId && <>Upstream ID: {item.sourceMediaId} · </>}
                {item.cameraId && <>Camera: {item.cameraId} · </>}
                {item.latitude != null && item.longitude != null && <>Position: {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)} · </>}
                {item.bearing != null && <>Bearing: {item.bearing}° · </>}
                {item.contentHash && <>SHA-256: {item.contentHash}</>}
              </div>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", fontSize: 12, display: "inline-block", marginTop: 6 }}>Open official source ↗</a>
            </div>
          </div>,
          document.body,
        );
      })()}
      {externalPreview && createPortal(
        <div role="dialog" aria-modal="true" aria-label={externalPreview.title}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setExternalPreview(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(2,5,10,.94)", display: "grid",
            gridTemplateRows: "auto minmax(0,1fr) auto", padding: 18, backdropFilter: "blur(8px)" }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><button type="button" onClick={() => setExternalPreview(null)}
            aria-label="Close lightbox" style={{ ...lightboxButton, fontSize: 22, width: 42 }}>×</button></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={externalPreview.src} alt={externalPreview.title}
            style={{ display: "block", maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", margin: "auto", borderRadius: 8 }} />
          <div style={{ color: "#f1f5f9", textAlign: "center", marginTop: 10 }}>{externalPreview.title}
            {externalPreview.meta && <div style={{ color: "#778398", fontSize: 11, marginTop: 3 }}>{externalPreview.meta}</div>}</div>
        </div>, document.body)}
    </AdminPageShell>
  );
}

const card: React.CSSProperties = { padding: 14, borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" };
const cardLabel: React.CSSProperties = { color: "#8b95a7", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 };
const sourceCell: React.CSSProperties = { color: "#9aa7b9", padding: "6px 8px", borderBottom: "1px solid #121824", verticalAlign: "top" };
const primary: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
const lightboxButton: React.CSSProperties = {
  width: 48,
  height: 48,
  padding: 0,
  borderRadius: 999,
  border: "1px solid #344054",
  background: "rgba(12,17,28,.82)",
  color: "#f8fafc",
  fontSize: 34,
  lineHeight: 1,
  cursor: "pointer",
};

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
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { EventTimelineBeat } from "@photonsurge/shared/events/event-timeline";
import type { Cam } from "@photonsurge/shared/cams/types";
import type { EventSnapshotMeta } from "@photonsurge/shared/db/event-snapshot-repo";
import type { VolcanoMedia } from "@photonsurge/shared/volcanoes/media";
import type { VolcanoCamera } from "@photonsurge/shared/volcanoes/media";
import type { iVolcanoMediaSource } from "@photonsurge/shared/db/volcano-media-source-model";
import type { VolcanoEruption } from "@photonsurge/shared/db/volcano-eruption-repo";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import { formatGvpDate } from "@photonsurge/shared/volcanoes/gvp-wfs";
import AdminPageShell from "../../../../components/admin/AdminPageShell";
import { severityColor } from "../../../../lib/alerts";
import { font, surface } from "../../../../theme/tokens";

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

/**
 * Every threat level on this page — GVP status, USGS colour code, VEI — is
 * expressed on the product's own severity ramp (DESIGN_BIBLE §4.4) rather than
 * a private green/orange/red, so a volcano's "unrest" and a storm warning's
 * "severe" are the same orange everywhere.
 */
const STATUS_RANK: Record<string, SeverityRank> = { erupting: 4, unrest: 3, dormant: 0 };
const USGS_RANK: Record<string, SeverityRank> = { RED: 4, ORANGE: 3, YELLOW: 2, GREEN: 1 };
/** VEI 0-7 onto the ramp's five ranks; the bar's width still carries the exact VEI. */
const VEI_RANK: SeverityRank[] = [0, 1, 1, 2, 2, 3, 4, 4];

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

/** Section heading — the HUD "chrome" voice shared by every card on the page. */
function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
      {children}
    </Typography>
  );
}

export default function VolcanoDetailPage() {
  const { volcanoId } = useParams<{ volcanoId: string }>();
  const [detail, setDetail] = useState<VolcanoDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [externalPreview, setExternalPreview] = useState<{ src: string; title: string; meta?: string } | null>(null);
  const [busyCam, setBusyCam] = useState<string | null>(null);
  const [searchOverride, setSearchOverride] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);
  const [overrideSaved, setOverrideSaved] = useState(false);

  const reload = useCallback(async () => {
    if (!volcanoId) return;
    const res = await fetch(`/api/admin/volcanoes/${encodeURIComponent(volcanoId)}`);
    if (!res.ok) {
      setMissing(true);
      return;
    }
    const next: VolcanoDetail = await res.json();
    setDetail(next);
    setSearchOverride(next.volcano.searchOverride ?? "");
  }, [volcanoId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Save (or clear, when blank) the operator's Wikipedia search term. The worker
   *  re-queries on its next enrich pass — nothing is fetched from here. */
  const saveSearchOverride = useCallback(async () => {
    setSavingOverride(true);
    setOverrideSaved(false);
    try {
      const res = await fetch(`/api/admin/volcanoes/${encodeURIComponent(volcanoId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ searchOverride: searchOverride.trim() }),
      });
      if (res.ok) {
        setOverrideSaved(true);
        await reload();
      }
    } finally {
      setSavingOverride(false);
    }
  }, [volcanoId, searchOverride, reload]);

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
        <Typography color="text.secondary">{missing ? "No such volcano." : "Loading…"}</Typography>
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
  const statusRank = STATUS_RANK[v.status];
  const usgsRank = v.usgsColorCode ? USGS_RANK[v.usgsColorCode] : undefined;

  return (
    <AdminPageShell
      title={`🌋 ${v.name}`}
      maxWidth={1100}
      crumbs={[{ href: "/admin/volcanoes", label: "Volcanoes" }, { label: v.name }]}
      description={
        <Stack component="span" direction="row" spacing={1} useFlexGap sx={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap" }}>
          <Box component="span" sx={{ fontWeight: 700, color: statusRank != null ? severityColor(statusRank) : "text.primary" }}>
            ● {v.status}
          </Box>
          {v.country && (
            <Box component="span" sx={{ color: "text.secondary" }}>
              {v.country}
            </Box>
          )}
          {v.usgsColorCode && (
            <Box component="span" sx={{ color: usgsRank != null ? severityColor(usgsRank) : "text.primary" }}>
              ● USGS {v.usgsColorCode}
              {v.usgsAlertLevel ? ` / ${v.usgsAlertLevel}` : ""}
            </Box>
          )}
        </Stack>
      }
      actions={
        <Button variant="outlined" onClick={reload}>
          Refresh
        </Button>
      }
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 1.75 }}>
        {/* Official status timeline (the promoted WatchedEvent's beats). */}
        <Paper sx={{ p: 1.75 }}>
          <CardLabel>Status timeline ({timeline.length})</CardLabel>
          {timeline.length === 0 && (
            <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
              No status changes recorded yet{detail.event ? "" : " — not promoted (needs EVENTS_UNIFIED_ENABLED)"}.
            </Typography>
          )}
          {timeline
            .slice()
            .reverse()
            .map((b, i) => (
              <Stack
                key={`${b.at}-${b.type}-${i}`}
                direction="row"
                spacing={1}
                sx={{ borderTop: "1px solid", borderColor: "divider", py: 0.875 }}
              >
                <Typography component="code" variant="body2" color="text.disabled" sx={{ whiteSpace: "nowrap" }}>
                  {fmtTime(b.at)}
                </Typography>
                <Box component="span" aria-hidden sx={{ width: 16, textAlign: "center" }}>
                  {beatGlyph(b.type)}
                </Box>
                <Typography variant="body2">{b.label}</Typography>
              </Stack>
            ))}
        </Paper>

        {/* Identity / facts. */}
        <Paper sx={{ p: 1.75 }}>
          <CardLabel>Volcano</CardLabel>
          <Table sx={{ mt: 1 }}>
            <TableBody>
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
                <TableRow key={k}>
                  <TableCell sx={{ color: "text.disabled", pl: 0, pr: 1.75, whiteSpace: "nowrap", verticalAlign: "top", border: 0 }}>
                    {k}
                  </TableCell>
                  {/*
                    IDs, elevations, coordinates and timestamps are all readings,
                    so this cell is mono — but the mono comes from `fontFamily`,
                    NOT `component="code"`. That rendered a <code> as a direct
                    child of <tr>, which only accepts <td>/<th>, and the browser
                    re-parented it into a hydration error.
                  */}
                  <TableCell sx={{ px: 0, wordBreak: "break-all", border: 0, fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>
                    {val}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>

        {/* Official (non-USGS) observatory status, e.g. GeoNet VAL. */}
        {v.officialAlertLevelRaw && (
          <Paper sx={{ p: 1.75 }}>
            <CardLabel>Official status</CardLabel>
            <Typography variant="body2" color="warning.main" sx={{ fontWeight: 600, mt: 1 }}>
              {(v.officialSource ?? "").toUpperCase()} {v.officialAlertScheme} · level {v.officialAlertLevelRaw}
              {v.officialAlertLevelNormalized ? ` (${v.officialAlertLevelNormalized})` : ""}
            </Typography>
            {v.officialActivity && (
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                {v.officialActivity}
              </Typography>
            )}
            {v.officialUpdatedAt && (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.75 }}>
                Updated {fmtTime(v.officialUpdatedAt)}
              </Typography>
            )}
          </Paper>
        )}

        {/* USGS notice, when present. */}
        {v.usgsColorCode && (
          <Paper sx={{ p: 1.75 }}>
            <CardLabel>USGS notice</CardLabel>
            <Typography variant="body2" sx={{ fontWeight: 600, mt: 1, color: usgsRank != null ? severityColor(usgsRank) : "text.primary" }}>
              ● {v.usgsColorCode}
              {v.usgsAlertLevel ? ` / ${v.usgsAlertLevel}` : ""}
            </Typography>
            {v.usgsNoticeSynopsis && (
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                {v.usgsNoticeSynopsis}
              </Typography>
            )}
            {v.usgsUpdatedAt && (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.75 }}>
                Updated {fmtTime(v.usgsUpdatedAt)}
              </Typography>
            )}
            {v.usgsNoticeUrl && (
              <MuiLink href={v.usgsNoticeUrl} target="_blank" rel="noreferrer" variant="body2" sx={{ display: "inline-block", mt: 0.75 }}>
                USGS notice ↗
              </MuiLink>
            )}
          </Paper>
        )}
      </Box>

      {/* This week's bulletin + parsed facts. */}
      {v.latestReport && (
        <Paper sx={{ p: 1.75, mt: 1.75 }}>
          <CardLabel>Latest bulletin</CardLabel>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {v.latestReport}
          </Typography>
          {(v.reportVei != null || v.reportPlumeHeightM != null) && (
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.75 }}>
              Parsed:{" "}
              {[
                v.reportVei != null ? `VEI ${v.reportVei}` : undefined,
                v.reportPlumeHeightM != null ? `plume ${v.reportPlumeHeightM.toLocaleString()} m` : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Typography>
          )}
        </Paper>
      )}

      {/* Official monitoring cameras — live latest still, each with an ON/OFF
          switch. "Some aren't great": a bad angle is a per-CAMERA judgement, so the
          toggle lives here. Switching one off stops it being captured, put on air,
          or counted — nothing auto-disables it back on, and nothing auto-decides
          quality for you. Active cameras sort first; anything the registry lost
          (the orphaned INGV archive rows) shows as OFF and can be purged wholesale
          from /admin/jobs → "Purge orphaned volcano cameras". */}
      {cams && cams.length > 0 && (
        <Paper sx={{ p: 1.75, mt: 1.75 }}>
          <CardLabel>
            Cameras ({camsOn.length} on
            {camsOff.length > 0 && (
              <Box component="span" sx={{ color: "text.disabled" }}>
                {" "}
                · {camsOff.length} off
              </Box>
            )}
            )
          </CardLabel>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", mt: 1.25 }}>
            {[...camsOn, ...camsOff].map((c) => {
              const on = c.status === "active";
              return (
                <Box key={c.camId} sx={{ width: 220, opacity: on ? 1 : 0.42 }}>
                  <ButtonBase
                    onClick={() => c.imageUrl && setExternalPreview({ src: c.imageUrl, title: c.title, meta: c.attribution?.provider })}
                    sx={{
                      display: "block",
                      width: 220,
                      textAlign: "left",
                      cursor: c.imageUrl ? "zoom-in" : "default",
                    }}
                  >
                    {c.imageUrl && (
                      <Box
                        component="img"
                        src={c.imageUrl}
                        alt={c.title}
                        sx={{
                          width: 220,
                          height: 138,
                          objectFit: "cover",
                          borderRadius: 1,
                          border: "1px solid",
                          // A camera that's switched off is greyed and edged in the
                          // "off" tone so a wall of thumbnails reads at a glance.
                          borderColor: on ? "divider" : "error.main",
                          bgcolor: surface.sunken,
                          filter: on ? undefined : "grayscale(1)",
                        }}
                      />
                    )}
                    <Typography variant="caption" sx={{ display: "block", mt: 0.5, wordBreak: "break-all" }}>
                      {c.title}
                    </Typography>
                    {c.attribution?.provider && (
                      <Typography variant="caption" color="text.disabled" sx={{ display: "block" }}>
                        {c.attribution.provider}
                      </Typography>
                    )}
                  </ButtonBase>
                  <Button
                    variant="outlined"
                    color={on ? "success" : "inherit"}
                    disabled={busyCam === c.camId}
                    onClick={() => toggleCam(c.camId, on ? "inactive" : "active")}
                    sx={{ mt: 0.625, minHeight: 24, py: 0.25, px: 1.25, fontSize: 11 }}
                  >
                    {busyCam === c.camId ? "…" : on ? "● On" : "○ Off"}
                  </Button>
                </Box>
              );
            })}
          </Stack>
        </Paper>
      )}

      {/* Worker-captured camera history — timelapse loops + recent archived frames
          (the "earlier today / this week" observation record). Needs the capture
          job (VOLCANO_CAM_SNAPSHOT_ENABLED) to have run. */}
      {(timelapses.length > 0 || capturedFrames.length > 0) && (
        <Paper sx={{ p: 1.75, mt: 1.75 }}>
          <CardLabel>Camera history ({snapshots.length})</CardLabel>
          {timelapses.length > 0 && (
            <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", mt: 1.25 }}>
              {timelapses.map((s) => (
                <Box component="figure" key={s.id} sx={{ m: 0, width: 320 }}>
                  <Box
                    component="img"
                    src={snapSrc(s)}
                    alt="timelapse"
                    sx={{ width: 320, height: 180, objectFit: "cover", borderRadius: 1, border: "1px solid", borderColor: "divider", bgcolor: surface.sunken }}
                  />
                  <Typography component="figcaption" variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.375 }}>
                    ▶ timelapse · {fmtTime(s.observationTime)}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
          {capturedFrames.length > 0 && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 1.5 }}>
              {capturedFrames.map((s) => (
                <Tooltip key={s.id} title={fmtTime(s.observationTime)}>
                  <Box component="a" href={snapSrc(s)} target="_blank" rel="noreferrer">
                    <Box
                      component="img"
                      src={snapSrc(s)}
                      alt="frame"
                      sx={{ width: 128, height: 80, objectFit: "cover", borderRadius: 0.5, border: "1px solid", borderColor: "divider", bgcolor: surface.sunken, display: "block" }}
                    />
                  </Box>
                </Tooltip>
              ))}
            </Stack>
          )}
        </Paper>
      )}

      {media.length > 0 && (
        <Paper sx={{ p: 1.75, mt: 1.75 }}>
          <CardLabel>Official media ({media.length})</CardLabel>
          {mediaGroups.map(([group, items]) => (
            <Box component="section" key={group} sx={{ mt: 1.75 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 0.875 }}>
                {items[0].source} · {items[0].type} ({items.length})
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 1.5 }}>
                {items.map((item) => {
                  const src = mediaSrc(item);
                  const lightboxItemIndex = lightboxMedia.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <Box component="figure" key={item.id} sx={{ m: 0, minWidth: 0 }}>
                      {src && item.type !== "VIDEO" && (
                        <ButtonBase
                          onClick={() => { if (lightboxItemIndex >= 0) setLightboxIndex(lightboxItemIndex); }}
                          aria-label={`Open ${item.title ?? item.caption ?? item.type}`}
                          sx={{ display: "block", width: "100%", cursor: "zoom-in" }}
                        >
                          <Box
                            component="img"
                            src={src}
                            alt={item.title ?? item.caption ?? item.type}
                            sx={{ width: "100%", height: 145, objectFit: "cover", borderRadius: 1, border: "1px solid", borderColor: "divider", bgcolor: surface.sunken, display: "block" }}
                          />
                        </ButtonBase>
                      )}
                      <Box component="figcaption" sx={{ mt: 0.625 }}>
                        <Typography variant="caption" sx={{ display: "block" }}>
                          {item.title ?? item.caption ?? item.type}
                        </Typography>
                        <Typography variant="caption" color="text.disabled" sx={{ display: "block" }}>
                          {item.source} · {item.type} · {fmtTime(item.observedAt?.toString() ?? item.acquiredAt.toString())}
                        </Typography>
                        {/* Licence is the thing that decides whether this can go on
                            air, so it gets the go/no-go colour rather than a caption grey. */}
                        <Typography variant="caption" color={item.reuseAllowed ? "success.main" : "warning.main"} sx={{ display: "block", fontSize: 10 }}>
                          {item.licence ?? "VERIFY"}
                          {item.reuseAllowed ? " · reusable" : " · internal review only"}
                        </Typography>
                        <MuiLink href={item.sourceUrl} target="_blank" rel="noreferrer" variant="caption" sx={{ fontSize: 11 }}>
                          Source ↗
                        </MuiLink>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Paper>
      )}

      {(mediaSources.length > 0 || volcanoCameras.length > 0) && (
        <Paper sx={{ p: 1.75, mt: 1.75 }}>
          <CardLabel>Monitoring sources ({mediaSources.length})</CardLabel>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 1.25, mt: 1.25 }}>
            {mediaSources.map((source) => {
              const sourceMedia = media.filter((item) => item.source === source.source);
              const sourceCameras = volcanoCameras.filter((camera) => camera.source === source.source);
              return (
                <Paper key={source.source} sx={{ p: 1.375, bgcolor: surface.raised }}>
                  <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                    <Typography variant="body2" component="strong" sx={{ fontWeight: 700 }}>
                      {source.name}
                    </Typography>
                    <Typography variant="caption" color={source.enabled ? "success.main" : "text.disabled"} sx={{ fontSize: 10 }}>
                      {source.enabled ? "ENABLED" : "DISABLED"}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.625 }}>
                    {sourceCameras.length} camera{sourceCameras.length === 1 ? "" : "s"} · {sourceMedia.length} archived item
                    {sourceMedia.length === 1 ? "" : "s"}
                  </Typography>
                  <Typography variant="caption" color={source.defaultReuseAllowed ? "success.main" : "warning.main"} sx={{ display: "block", mt: 0.375 }}>
                    {source.defaultLicence ?? "VERIFY"} · {source.defaultReuseAllowed ? "default reusable" : "review before reuse"}
                  </Typography>
                  {source.attribution && (
                    <Typography variant="caption" color="text.disabled" sx={{ display: "block", fontSize: 10, mt: 0.375 }}>
                      {source.attribution}
                    </Typography>
                  )}
                  {source.lastDiscoveredAt && (
                    <Typography variant="caption" color="text.disabled" sx={{ display: "block", fontSize: 10, mt: 0.375 }}>
                      Registry checked {fmtTime(source.lastDiscoveredAt.toString())}
                    </Typography>
                  )}
                  {source.lastError && (
                    <Typography variant="caption" color="error.main" sx={{ display: "block", fontSize: 10, mt: 0.375 }}>
                      Last error: {source.lastError}
                    </Typography>
                  )}
                  <MuiLink href={source.registryUrl} target="_blank" rel="noreferrer" variant="caption" sx={{ display: "inline-block", fontSize: 11, mt: 0.625 }}>
                    Source registry ↗
                  </MuiLink>
                </Paper>
              );
            })}
          </Box>
          {volcanoCameras.length > 0 && (
            <Box component="details" sx={{ mt: 1.5 }}>
              <Box component="summary" sx={{ color: "text.secondary", fontSize: 12, cursor: "pointer" }}>
                Camera registry details ({volcanoCameras.length})
              </Box>
              <Box sx={{ overflowX: "auto", mt: 1 }}>
                <Table sx={{ "& .MuiTableCell-root": { fontSize: 11 } }}>
                  <TableHead>
                    <TableRow>
                      {["Source", "Camera", "Mode", "Coordinates", "Bearing", "Upstream time", "Rights"].map((label) => (
                        <TableCell key={label}>{label}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {volcanoCameras.map((camera) => (
                      <TableRow key={camera.id}>
                        <TableCell sx={sourceCell}>{camera.source}</TableCell>
                        <TableCell sx={sourceCell}>
                          <MuiLink href={camera.detailUrl} target="_blank" rel="noreferrer">
                            {camera.name}
                          </MuiLink>
                          <Box component="code" sx={{ display: "block", color: "text.disabled" }}>
                            {camera.sourceCameraId}
                          </Box>
                        </TableCell>
                        <TableCell sx={sourceCell}>{camera.mode}</TableCell>
                        <TableCell sx={{ ...sourceCell, fontFamily: "monospace" }}>
                          {camera.latitude != null && camera.longitude != null
                            ? `${camera.latitude.toFixed(4)}, ${camera.longitude.toFixed(4)}`
                            : "—"}
                        </TableCell>
                        <TableCell sx={{ ...sourceCell, fontFamily: "monospace" }}>{camera.bearing != null ? `${camera.bearing}°` : "—"}</TableCell>
                        <TableCell sx={{ ...sourceCell, fontFamily: "monospace" }}>{camera.upstreamTimestamp ?? "—"}</TableCell>
                        <TableCell sx={sourceCell}>{camera.licence ?? "VERIFY"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          )}
        </Paper>
      )}

      {/* Eruption history — a CATALOG fact, so it renders for every volcano
          (dormant included), independent of any WatchedEvent. This is Band 2 of
          the planned per-volcano timeline. Empty until `seedEruptions` has run. */}
      {eruptions.length > 0 && (
        <Paper sx={{ p: 1.75, mt: 1.75 }}>
          <CardLabel>Eruption history ({eruptions.length})</CardLabel>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", my: 0.75, mb: 1.25 }}>
            {since1900} since 1900
            {largestVei !== undefined && <> · largest VEI {largestVei}</>}
            {" · oldest "}
            {eruptionDate(eruptions[eruptions.length - 1], "start")}
          </Typography>
          <Box sx={{ maxHeight: 420, overflowY: "auto" }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Start</TableCell>
                  <TableCell>End</TableCell>
                  <TableCell>VEI</TableCell>
                  <Tooltip title="How GVP established the start date — only really meaningful for prehistoric eruptions">
                    <TableCell>Dated by</TableCell>
                  </Tooltip>
                </TableRow>
              </TableHead>
              <TableBody>
                {eruptions.map((e) => (
                  <TableRow key={e.eruptionNumber}>
                    {/* Dates are readings — mono keeps the fuzzy BCE/"?" forms aligned. */}
                    <TableCell sx={{ pl: 0, whiteSpace: "nowrap", fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>
                      {eruptionDate(e, "start")}
                      {!e.confirmed && (
                        <Tooltip title="Uncertain eruption">
                          <Box component="span" sx={{ color: "text.disabled" }}>
                            {" "}
                            ?
                          </Box>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap", fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>
                      {eruptionDate(e, "end")}
                    </TableCell>
                    <TableCell>
                      {e.vei !== undefined ? (
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                          <Box
                            aria-hidden
                            sx={{
                              display: "inline-block",
                              height: 8,
                              borderRadius: 0.25,
                              width: Math.max(6, (e.vei + 1) * 7),
                              bgcolor: severityColor(VEI_RANK[e.vei] ?? 0),
                            }}
                          />
                          <Box component="code">{e.vei}</Box>
                        </Stack>
                      ) : (
                        <Box component="span" sx={{ color: "text.disabled" }}>
                          —
                        </Box>
                      )}
                    </TableCell>
                    <TableCell sx={{ px: 0, color: datedBy(e.startEvidence).dim ? "text.disabled" : "text.secondary" }}>
                      {datedBy(e.startEvidence).text}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      {/* Wikipedia search term. Renders ALWAYS — unlike the About card below, which
          needs enrichment to have landed. The override exists precisely for the
          volcanoes that never matched an article, so hiding it on a miss would
          hide it exactly when it's needed. */}
      <Paper sx={{ p: 1.75, mt: 1.75 }}>
        <CardLabel>Wikipedia search</CardLabel>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, mb: 1.25, lineHeight: 1.5 }}>
          Enrichment searches Wikipedia by the volcano&apos;s name (<Box component="span" sx={{ color: "text.primary" }}>{v.name}</Box>).
          Set a term here when that finds the wrong article or nothing at all — it replaces the guesses entirely.
          Leave blank to go back to searching by name. Saving re-queues this volcano for the next enrich pass.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            value={searchOverride}
            onChange={(e) => { setSearchOverride(e.target.value); setOverrideSaved(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") saveSearchOverride(); }}
            placeholder={`Search by name (${v.name})`}
            slotProps={{ htmlInput: { "aria-label": "Wikipedia search term" } }}
            sx={{ flex: "1 1 260px" }}
          />
          {/* The page's one real mutation, so it's the one contained button (§5.6). */}
          <Button
            variant="contained"
            onClick={saveSearchOverride}
            disabled={savingOverride || searchOverride.trim() === (v.searchOverride ?? "")}
          >
            {savingOverride ? "Saving…" : "Save"}
          </Button>
        </Stack>
        <Typography variant="caption" color={overrideSaved ? "success.main" : "text.disabled"} sx={{ display: "block", mt: 1 }}>
          {overrideSaved
            ? "Saved — will re-query on the next Wikipedia enrich run."
            : v.searchOverride
              ? `Overridden${v.wikiFetchedAt ? "" : " · awaiting the next enrich run"}. Last checked ${fmtTime(v.wikiFetchedAt)}.`
              : `Searching by name. Last checked ${fmtTime(v.wikiFetchedAt)}${v.wikiTitle ? ` · matched "${v.wikiTitle}"` : v.wikiFetchedAt ? " · no match" : ""}.`}
        </Typography>
      </Paper>

      {/* Wikipedia enrichment. */}
      {(v.wikiPhoto || v.wikiThumb || v.wikiExtract) && (
        <Paper sx={{ p: 1.75, mt: 1.75 }}>
          <CardLabel>About</CardLabel>
          <Stack direction="row" spacing={1.75} useFlexGap sx={{ mt: 1, flexWrap: "wrap" }}>
            {(v.wikiPhoto || v.wikiThumb) && (
              <ButtonBase
                onClick={() => setExternalPreview({ src: v.wikiPhoto || v.wikiThumb!, title: `${v.name} reference image`, meta: "Wikipedia / Wikimedia" })}
                sx={{ cursor: "zoom-in" }}
              >
                <Box
                  component="img"
                  src={v.wikiPhoto || v.wikiThumb}
                  alt=""
                  sx={{ width: 240, height: 150, objectFit: "cover", borderRadius: 1, bgcolor: surface.sunken, display: "block" }}
                />
              </ButtonBase>
            )}
            {v.wikiExtract && (
              <Typography variant="body2" sx={{ flex: "1 1 260px" }}>
                {v.wikiExtract}
              </Typography>
            )}
          </Stack>
          <Stack direction="row" spacing={1.75} sx={{ mt: 1 }}>
            {v.wikiTitle && (
              <MuiLink
                href={`https://en.wikipedia.org/wiki/${encodeURIComponent(v.wikiTitle.replace(/ /g, "_"))}`}
                target="_blank"
                rel="noreferrer"
                variant="body2"
              >
                Wikipedia ↗
              </MuiLink>
            )}
            {v.sourceUrl && (
              <MuiLink href={v.sourceUrl} target="_blank" rel="noreferrer" variant="body2">
                GVP report ↗
              </MuiLink>
            )}
          </Stack>
        </Paper>
      )}

      <Box sx={{ mt: 2 }}>
        <MuiLink component={Link} href="/admin/volcanoes" variant="body2">
          ← All volcanoes
        </MuiLink>
      </Box>

      {lightboxIndex != null && lightboxMedia[lightboxIndex] && (() => {
        const item = lightboxMedia[lightboxIndex];
        const src = mediaSrc(item);
        return createPortal(
          <Box
            role="dialog"
            aria-modal="true"
            aria-label={item.title ?? item.caption ?? "Volcano media"}
            onMouseDown={(event: React.MouseEvent) => { if (event.target === event.currentTarget) setLightboxIndex(null); }}
            sx={lightboxScrim}
          >
            <Stack direction="row" spacing={1.5} sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="caption" color="text.secondary">
                {lightboxIndex + 1} / {lightboxMedia.length} · {item.source} · {item.type}
              </Typography>
              <Button onClick={() => setLightboxIndex(null)} aria-label="Close lightbox" sx={{ ...lightboxButton, fontSize: 22, minWidth: 42 }}>
                ×
              </Button>
            </Stack>
            <Box sx={{ minHeight: 0, display: "grid", gridTemplateColumns: "52px minmax(0, 1fr) 52px", alignItems: "center", gap: 1.5 }}>
              <Button
                onClick={() => setLightboxIndex((lightboxIndex - 1 + lightboxMedia.length) % lightboxMedia.length)}
                aria-label="Previous image"
                sx={lightboxButton}
              >
                ‹
              </Button>
              {src && (
                <Box
                  component="img"
                  src={src}
                  alt={item.title ?? item.caption ?? item.type}
                  sx={{ display: "block", maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", m: "auto", objectFit: "contain", borderRadius: 1 }}
                />
              )}
              <Button onClick={() => setLightboxIndex((lightboxIndex + 1) % lightboxMedia.length)} aria-label="Next image" sx={lightboxButton}>
                ›
              </Button>
            </Box>
            <Box sx={{ width: "min(900px, 100%)", mx: "auto", mt: 1.5, textAlign: "center" }}>
              <Typography sx={{ fontSize: 15, fontWeight: 600 }}>{item.title ?? item.caption ?? item.type}</Typography>
              {item.title && item.caption && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {item.caption}
                </Typography>
              )}
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", fontSize: 11, mt: 0.75 }}>
                {fmtTime(item.observedAt?.toString() ?? item.acquiredAt.toString())} · {item.attribution ?? item.source} · {item.licence ?? "VERIFY"}
                {item.reuseAllowed ? " · reusable" : " · internal review only"}
              </Typography>
              <Typography component="code" color="text.disabled" sx={{ display: "block", fontSize: 10, mt: 0.625, overflowWrap: "anywhere" }}>
                {item.sourceMediaId && <>Upstream ID: {item.sourceMediaId} · </>}
                {item.cameraId && <>Camera: {item.cameraId} · </>}
                {item.latitude != null && item.longitude != null && <>Position: {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)} · </>}
                {item.bearing != null && <>Bearing: {item.bearing}° · </>}
                {item.contentHash && <>SHA-256: {item.contentHash}</>}
              </Typography>
              <MuiLink href={item.sourceUrl} target="_blank" rel="noreferrer" variant="caption" sx={{ display: "inline-block", mt: 0.75 }}>
                Open official source ↗
              </MuiLink>
            </Box>
          </Box>,
          document.body,
        );
      })()}
      {externalPreview && createPortal(
        <Box
          role="dialog"
          aria-modal="true"
          aria-label={externalPreview.title}
          onMouseDown={(event: React.MouseEvent) => { if (event.target === event.currentTarget) setExternalPreview(null); }}
          sx={lightboxScrim}
        >
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={() => setExternalPreview(null)} aria-label="Close lightbox" sx={{ ...lightboxButton, fontSize: 22, minWidth: 42 }}>
              ×
            </Button>
          </Box>
          <Box
            component="img"
            src={externalPreview.src}
            alt={externalPreview.title}
            sx={{ display: "block", maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", m: "auto", borderRadius: 1 }}
          />
          <Box sx={{ textAlign: "center", mt: 1.25 }}>
            {externalPreview.title}
            {externalPreview.meta && (
              <Typography variant="caption" color="text.disabled" sx={{ display: "block", fontSize: 11, mt: 0.375 }}>
                {externalPreview.meta}
              </Typography>
            )}
          </Box>
        </Box>,
        document.body,
      )}
    </AdminPageShell>
  );
}

const sourceCell = { color: "text.secondary", verticalAlign: "top" } as const;

/**
 * The lightbox scrim. Flat and near-opaque rather than the broadcast layer's
 * blurred glass — §4.6 keeps that language out of the engine room.
 */
const lightboxScrim = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  bgcolor: surface.page,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  p: 2.25,
} as const;

const lightboxButton = {
  width: 48,
  minWidth: 48,
  height: 48,
  p: 0,
  borderRadius: "999px",
  border: "1px solid",
  borderColor: "divider",
  bgcolor: surface.raised,
  color: "text.primary",
  fontSize: 34,
  lineHeight: 1,
} as const;

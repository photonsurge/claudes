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
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
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
  formatPeople,
  getAlertDetail,
  primaryInfo,
  severityColor,
  severityLabel,
  type AlertDetail,
} from "../../../../lib/alerts";
import { alertBbox } from "../../../../lib/alertGroups";
import { hazardMeta } from "../../../../lib/hazard";
import { fmtDuration } from "../../../../lib/airlog";
import { satelliteViewLabel } from "../../../../lib/satellite-view";
import { surface } from "../../../../theme/tokens";

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

/** The uppercase eyebrow every card on this page leads with. */
function CardLabel({ children, sx }: { children: React.ReactNode; sx?: object }) {
  return (
    <Typography variant="overline" color="text.secondary" component="div" sx={sx}>
      {children}
    </Typography>
  );
}

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
        <Typography variant="body2" color="text.secondary">
          {missing ? "No such alert." : "Loading…"}
        </Typography>
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
        <Box component="span" sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.875 }}>
          <Box
            component="span"
            aria-label="Alert location"
            sx={{ display: "inline-flex", alignItems: "center", gap: 1.125, flexWrap: "wrap", color: "text.primary", fontWeight: 600 }}
          >
            <Box component="span">
              <Box component="span" sx={locationLabelSx}>
                Region
              </Box>{" "}
              {location.region ?? "Unknown"}
            </Box>
            <Box component="span" aria-hidden sx={{ color: "text.disabled" }}>
              ·
            </Box>
            <Box component="span">
              <Box component="span" sx={locationLabelSx}>
                Country
              </Box>{" "}
              {location.country ?? "Unknown"}
            </Box>
          </Box>
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            {/*
              Filled with the rank's own ramp colour (DESIGN_BIBLE §4.4) rather
              than a theme semantic: the rank IS the meaning here.
            */}
            <Box
              component="span"
              title={severityLabel(rank)}
              sx={{
                px: 1.125,
                borderRadius: 1,
                fontWeight: 700,
                fontSize: 12,
                color: surface.page,
                bgcolor: severityColor(rank),
              }}
            >
              {rank} · {severityLabel(rank)}
            </Box>
            <Box component="span" sx={{ color: h.color }}>
              {h.label}
            </Box>
            <Chip label={alert.source} />
            <Box component="span">{alert.msgType}</Box>
            <Box component="span" sx={{ color: alert.active ? "success.main" : "text.secondary" }}>
              {alert.active ? "active" : "inactive"}
            </Box>
            {(() => {
              // Cities-based estimate of people under the footprint — labelled as
              // an estimate ("≈", "in cities"), never presented as a headcount.
              const people = formatPeople(alert.population);
              if (!people) return null;
              return (
                <Box
                  component="span"
                  title={`≈ ${alert.population!.toLocaleString("en-US")} people across ${alert.cityCount ?? 0} catalogued cities — a cities-based estimate, not a census`}
                  sx={{ color: "text.secondary" }}
                >
                  ≈ {people} in {alert.cityCount ?? 0} cit{(alert.cityCount ?? 0) === 1 ? "y" : "ies"}
                </Box>
              );
            })()}
          </Box>
        </Box>
      }
      actions={
        <Button variant="outlined" onClick={reload}>
          Refresh
        </Button>
      }
    >
      {lightbox && <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 1.75 }}>
        {/* Change timeline — derived from in-place revisions + the CAP chain. */}
        <Paper sx={{ p: 1.75 }}>
          <CardLabel>Timeline ({timeline.length})</CardLabel>
          {timeline.length === 0 && (
            <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
              No changes recorded yet — just the initial bulletin.
            </Typography>
          )}
          {timeline.map((b, i) => (
            <Stack
              key={`${b.at}-${b.type}-${i}`}
              direction="row"
              spacing={1}
              sx={{ borderTop: 1, borderColor: "divider", py: 0.875 }}
            >
              <Typography variant="body2" color="text.disabled" sx={{ whiteSpace: "nowrap" }}>
                <code>{fmtTime(b.at)}</code>
              </Typography>
              <Box component="span" aria-hidden sx={{ width: 16, textAlign: "center" }}>
                {beatGlyph(b.type)}
              </Box>
              <Typography variant="body2">
                {b.label}
                {typeof b.severityRank === "number" && (
                  <Box component="span" sx={{ ml: 0.75, color: severityColor(b.severityRank) }}>
                    · {severityLabel(b.severityRank)}
                  </Box>
                )}
              </Typography>
            </Stack>
          ))}
        </Paper>

        {/* Message lifecycle / identity */}
        <Paper sx={{ p: 1.75 }}>
          <CardLabel>Message</CardLabel>
          <Table sx={{ mt: 1 }}>
            <TableBody>
              {[
                ["Identifier", alert.identifier],
                ["Sender", alert.sender || "—"],
                ["Sent", fmtTime(alert.sent)],
                ["Status", `${alert.status}${alert.scope ? ` · ${alert.scope}` : ""}`],
                ["Ingested", fmtTime(alert.ingestedAt)],
                ["Expires", fmtTime(alert.expiresAt)],
                ["References", alert.references?.length ? `${alert.references.length} message(s)` : "none"],
              ].map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell sx={{ color: "text.disabled", border: 0, py: 0.375, pl: 0, pr: 1.75, whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {k}
                  </TableCell>
                  <TableCell sx={{ border: 0, py: 0.375, px: 0, wordBreak: "break-all" }}>
                    <code>{v}</code>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>

        {/* As-run history: every director cut that aired this alert. */}
        <Paper sx={{ p: 1.75 }}>
          <CardLabel>On air ({aired.length})</CardLabel>
          {aired.length === 0 && (
            <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
              The director hasn&apos;t aired this alert (or it aired before as-run logging).
            </Typography>
          )}
          {aired.map((e) => (
            <Box key={e.id} sx={{ borderTop: 1, borderColor: "divider", py: 0.875 }}>
              <MuiLink component={Link} href={`/admin/runs/${e.runId}`} variant="body2">
                <code>{fmtTime(e.startedAt)}</code>
              </MuiLink>
              <Typography component="span" variant="body2" color="text.secondary">
                {" "}
                · shot #{e.seq}
                {e.actualMs != null ? ` · ${fmtDuration(e.actualMs)} on screen` : " · on air"}
                {e.breaking ? " · ⚡ breaking" : ""}
                {e.endReason === "skipped" ? " · skipped early" : ""}
              </Typography>
            </Box>
          ))}
        </Paper>

        {/* CAP lifecycle chain */}
        <Paper sx={{ p: 1.75 }}>
          <CardLabel>Update chain ({chain.length})</CardLabel>
          {chain.length <= 1 && (
            <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
              No related updates — a single message so far.
            </Typography>
          )}
          {chain.length > 1 &&
            chain.map((c) => {
              const current = c.id === alert.id;
              return (
                <Box key={c.id} sx={{ borderTop: 1, borderColor: "divider", py: 0.875 }}>
                  {/* The message you're looking at gets the accent chip. */}
                  <Chip label={c.msgType} color={current ? "primary" : "default"} sx={{ mr: 0.75 }} />
                  {current ? (
                    <Typography component="span" variant="body2">
                      <code>{fmtTime(c.sent)}</code> (this message)
                    </Typography>
                  ) : (
                    <MuiLink component={Link} href={`/admin/alerts/${c.id}`} variant="body2">
                      <code>{fmtTime(c.sent)}</code>
                    </MuiLink>
                  )}
                  <Typography component="span" variant="body2" color="text.secondary">
                    {" "}
                    · sev {c.maxSeverityRank}
                    {c.active ? " · active" : ""}
                  </Typography>
                </Box>
              );
            })}
        </Paper>
      </Box>

      {/* Location — the alert's own CAP area(s) drawn on the shared globe. */}
      {previewState && features.length > 0 && (
        <Paper sx={{ mt: 1.75, overflow: "hidden" }}>
          <CardLabel sx={{ pt: 1.75, px: 1.75 }}>
            Location{features.length > 1 ? ` · ${features.length} areas` : ""}
          </CardLabel>
          <Box sx={{ position: "relative", height: 420, mt: 1.5 }}>
            <GlobeView
              ref={globe}
              state={previewState}
              manifest={null}
              cities={[]}
              alerts={features}
              pulseAt={pulseAt}
              interactive
            />
          </Box>
        </Paper>
      )}

      {/* Imagery, resources & trends — the P1/P2 satellite/camera/GDACS harvest. */}
      {(snapshots.length > 0 || resources.length > 0 || series.length > 0) && (
        <Paper sx={{ p: 1.75, mt: 1.75 }}>
          <CardLabel>Imagery, resources &amp; trends</CardLabel>

          {snapshots.length > 0 && (
            <Stack direction="row" spacing={1.25} sx={{ flexWrap: "wrap", gap: 1.25, mt: 1.25 }}>
              {snapshots.slice(0, 12).map((s) => {
                const src = `/api/alerts/snapshot/${s.id}?v=${encodeURIComponent(s.capturedAt)}`;
                const caption = `${s.kind === "satellite" ? satelliteViewLabel(s.layer) : s.kind}${s.distanceKm != null ? ` · ${Math.round(s.distanceKm)} km` : ""} · ${fmtTime(s.observationTime)}`;
                return (
                  <ButtonBase
                    key={s.id}
                    aria-label={`Open ${s.kind} image full screen`}
                    onClick={() => setLightbox({ src, alt: s.kind, caption })}
                    sx={{ display: "block", width: 160, textAlign: "left", cursor: "zoom-in" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <Box
                      component="img"
                      src={src}
                      alt={s.kind}
                      sx={{
                        width: 160,
                        height: 100,
                        objectFit: "cover",
                        borderRadius: 1,
                        border: 1,
                        borderColor: "divider",
                        bgcolor: surface.sunken,
                      }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.375 }}>
                      {caption}
                    </Typography>
                  </ButtonBase>
                );
              })}
            </Stack>
          )}

          {series.length > 0 && (
            <Box sx={{ mt: 1.75, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 1.5 }}>
              {series.map((m) => (
                <Box key={m.metric} sx={{ borderTop: 1, borderColor: "divider", pt: 1 }}>
                  <Typography variant="body2">
                    {m.metric}{" "}
                    <Typography component="span" variant="body2" color="text.secondary">
                      · <code>{m.latest}</code>
                    </Typography>
                  </Typography>
                  <Sparkline samples={m.samples} width={200} height={30} />
                </Box>
              ))}
            </Box>
          )}

          {resources.length > 0 && (
            <Box sx={{ mt: 1.75 }}>
              <CardLabel>Resources</CardLabel>
              {resources.map((r) => (
                <Box key={r.id ?? r.url} sx={{ mt: 0.5 }}>
                  <Typography component="span" variant="body2" color="text.disabled">
                    {r.kind}
                  </Typography>{" "}
                  <MuiLink href={r.url} target="_blank" rel="noreferrer" variant="body2" sx={{ wordBreak: "break-all" }}>
                    {r.description || r.url}
                  </MuiLink>
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      )}

      {/* Full CAP content */}
      {alert.info.map((inf, i) => (
        <AlertInfoBlock key={i} info={inf} index={i} />
      ))}

      {/* Raw feed payload, for debugging adapters. */}
      <Box component="details" sx={{ mt: 2 }}>
        <Box component="summary" sx={{ color: "text.secondary", cursor: "pointer", fontSize: 13 }}>
          Raw document
        </Box>
        <Box
          component="pre"
          sx={{
            mt: 1,
            px: 1.75,
            py: 1.5,
            bgcolor: surface.sunken,
            color: "text.secondary",
            fontSize: 12,
            lineHeight: 1.5,
            borderRadius: 1,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(alert, null, 2)}
        </Box>
      </Box>
    </AdminPageShell>
  );
}

const locationLabelSx = {
  color: "text.secondary",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  textTransform: "uppercase",
} as const;

"use client";

/**
 * /admin/alerts — operator view of ingested weather alerts. Lists from
 * GET /api/alerts with a few filters; coloured by normalised severityRank.
 * Read-only for now (ingest is the worker's job); live Socket.IO deltas + the
 * map overlay are a later milestone.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import {
  listAlerts,
  getAlertDetail,
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
  type Alert as AlertDoc,
  type AlertInfo,
} from "../../../lib/alerts";
import { alertCountryCode, alertCountryName, flagOf } from "@photonsurge/shared/alerts/country";
import { HAZARDS, hazardMeta } from "../../../lib/hazard";
import { bucketByGroupId } from "../../../lib/alertGroups";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import AlertCoverageStrip from "../../../components/admin/AlertCoverageStrip";
import { useTableSort } from "../../../components/admin/useTableSort";
import { surface } from "../../../theme/tokens";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [severityMin, setSeverityMin] = useState(0);
  const [loading, setLoading] = useState(false);
  const [debugId, setDebugId] = useState<string | null>(null);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [translateMsg, setTranslateMsg] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [hazardFilter, setHazardFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [query, setQuery] = useState("");

  // Full (non-lean) docs for whichever group's Debug modal is open — the list
  // itself is fetched lean (no raw description / geocodes) to keep the whole-
  // world load small, so the Debug view lazy-fetches the full doc per member on
  // demand. Keyed by alert id; falls back to the lean row until it arrives.
  const [fullById, setFullById] = useState<Record<string, AlertDoc>>({});
  const fullRef = useRef(fullById);
  fullRef.current = fullById;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // limit 0 = no cap: fetch every matching alert (the whole world). lean =
      // drop the raw description + per-area geocodes the table never shows (the
      // Debug modal lazy-loads the full doc); keeps this world-wide pull light.
      setAlerts(await listAlerts({ activeOnly, severityMin, limit: 0, lean: true, omitCoordinates: true }));
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

  // The list is fetched with omitCoordinates, so the server computes repPoint — the
  // first usable [lng,lat] across the alert's areas — and leaves it absent when no
  // area carried geometry (a geocode-only alert: it names a region but ships no
  // shape). That absence IS "no position info". Count both buckets for the dropdown.
  let withPos = 0;
  for (const a of alerts) if (a.repPoint) withPos++;
  const noPos = alerts.length - withPos;

  const shown = alerts.filter((a) => {
    if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
    if (hazardFilter !== "all" && alertHazard(a) !== hazardFilter) return false;
    if (positionFilter === "has" && !a.repPoint) return false;
    if (positionFilter === "none" && a.repPoint) return false;
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
  const sortedGroups = useTableSort(groups, {
    severity: (g) => g.maxSeverityRank,
    hazard: (g) => hazardMeta(g.hazard).label,
    event: (g) => displayHeadline(primaryInfo(g.representative)) ?? primaryInfo(g.representative)?.event,
    // Unknown countries sort to the end in both directions rather than heading
    // the ascending list as a block of blanks.
    country: (g) => alertCountryName(g.representative) ?? "￿",
    area: (g) => areaSummary(g.representative),
    sources: (g) => g.sources.length,
    message: (g) => g.representative.msgType,
    translated: (g) => translationStatus(g.representative),
    expires: (g) => g.representative.expiresAt,
  }, "severity", true);

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

  // When a Debug modal opens, lazy-load the full (non-lean) doc for each of the
  // group's members so the modal can show the raw description + full JSON that
  // the lean list omits. Fetched once per id (cached in fullById), via the
  // per-alert detail route. Read the cache through a ref so this only re-runs on
  // debugId change, not on every fill-in.
  useEffect(() => {
    if (!debugGroup) return;
    let cancelled = false;
    const need = debugGroup.members.map((m) => m.id).filter((id) => !fullRef.current[id]);
    if (need.length === 0) return;
    Promise.all(need.map((id) => getAlertDetail(id).then((d) => [id, d?.alert] as const))).then((pairs) => {
      if (cancelled) return;
      setFullById((cur) => {
        const next = { ...cur };
        for (const [id, doc] of pairs) if (doc) next[id] = doc as AlertDoc;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [debugId]); // eslint-disable-line react-hooks/exhaustive-deps -- debugGroup derives from debugId; fullById read via ref

  return (
    <AdminPageShell
      title="Weather alerts"
      // 11 columns of live alert data — the shell's 1100px default clipped the
      // Debug column off the right edge entirely. This table wants the viewport.
      maxWidth="none"
      description={
        <>
          {groups.length} event{groups.length === 1 ? "" : "s"}
          {shown.length !== groups.length ? ` · ${shown.length} alerts` : ""}
          {shown.length !== alerts.length ? ` of ${alerts.length}` : ""}
        </>
      }
      actions={
        <Stack direction="row" spacing={1.75} sx={{ alignItems: "center", flexWrap: "wrap", gap: 1.75 }}>
          <TextField
            select
            label="Source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="all">all adapters</MenuItem>
            {sources.map((s) => (
              <MenuItem key={s} value={s}>
                {s} ({bySource[s]})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Hazard"
            value={hazardFilter}
            onChange={(e) => setHazardFilter(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="all">all types</MenuItem>
            {HAZARDS.filter((h) => byHazard[h.id]).map((h) => (
              <MenuItem key={h.id} value={h.id}>
                {h.icon} {h.label} ({byHazard[h.id]})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Position"
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="all">any position</MenuItem>
            <MenuItem value="has">has position ({withPos})</MenuItem>
            <MenuItem value="none">no position ({noPos})</MenuItem>
          </TextField>
          <TextField
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="type / area…"
            sx={{ minWidth: 130 }}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />}
            label={<Typography variant="body2">Active only</Typography>}
          />
          <TextField
            select
            label="Min severity"
            value={String(severityMin)}
            onChange={(e) => setSeverityMin(Number(e.target.value))}
            sx={{ minWidth: 150 }}
          >
            {[0, 1, 2, 3, 4].map((r) => (
              <MenuItem key={r} value={String(r)}>
                {r} — {severityLabel(r as 0)}
              </MenuItem>
            ))}
          </TextField>
          {/* Refresh is this view's one primary action; the job triggers stay quiet. */}
          <Button variant="contained" onClick={reload} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </Button>
          <Button variant="outlined" onClick={ingestNow} disabled={!!ingestMsg}>
            Ingest now
          </Button>
          <Button variant="outlined" onClick={translateNow} disabled={!!translateMsg}>
            Translate now
          </Button>
        </Stack>
      }
    >
      {ingestMsg && (
        <Alert severity={ingestMsg.startsWith("Failed") ? "error" : "success"} sx={{ mt: 1 }}>
          {ingestMsg}
        </Alert>
      )}
      {translateMsg && (
        <Alert severity={translateMsg.startsWith("Failed") ? "error" : "success"} sx={{ mt: 1 }}>
          {translateMsg}
        </Alert>
      )}

      {/* Drawable-geometry health of active alerts — "how many are failing to draw". */}
      <AlertCoverageStrip />

      <TableContainer component={Paper} sx={{ mt: 2.5 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{sortedGroups.header("severity", "Sev")}</TableCell>
              <TableCell>{sortedGroups.header("hazard", "Hazard")}</TableCell>
              <TableCell>{sortedGroups.header("event", "Event")}</TableCell>
              <TableCell>{sortedGroups.header("country", "Country")}</TableCell>
              <TableCell>{sortedGroups.header("area", "Area")}</TableCell>
              <TableCell>{sortedGroups.header("sources", "Sources")}</TableCell>
              <TableCell>{sortedGroups.header("message", "Msg")}</TableCell>
              <TableCell>{sortedGroups.header("translated", "Translated")}</TableCell>
              <TableCell>{sortedGroups.header("expires", "Expires")}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedGroups.rows.map((g) => {
              const rep = g.representative;
              const info = primaryInfo(rep);
              const multi = g.members.length > 1;
              const h = hazardMeta(g.hazard);
              const rank = g.maxSeverityRank;
              const hx = (n: number) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0");
              return (
                <Fragment key={g.id}>
                  <TableRow sx={{ opacity: rep.active ? 1 : 0.5 }}>
                    <TableCell sx={{ verticalAlign: "top" }}>
                      {/*
                        Filled with the rank's own ramp colour (DESIGN_BIBLE §4.4)
                        rather than a theme semantic: the rank IS the meaning.
                      */}
                      <Box
                        component="span"
                        title={severityLabel(rank)}
                        sx={{
                          display: "inline-block",
                          width: 26,
                          textAlign: "center",
                          borderRadius: 1,
                          py: 0.25,
                          fontWeight: 700,
                          color: surface.page,
                          bgcolor: severityColor(rank),
                        }}
                      >
                        {rank}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                      {/* Chip intensity scales with severityRank (0–4). */}
                      <Box
                        component="span"
                        title={`${h.label} · ${severityLabel(rank)}`}
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.5,
                          px: 1,
                          py: 0.25,
                          borderRadius: 1,
                          fontSize: 12,
                          fontWeight: rank >= 3 ? 700 : 500,
                          bgcolor: `${h.color}${hx(0x12 + rank * 0x18)}`,
                          color: h.color,
                          border: `1px solid ${h.color}${hx(0x3a + rank * 0x32)}`,
                        }}
                      >
                        {h.icon} {h.label}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: "top" }}>
                      {(() => {
                        const headline = displayHeadline(info) ?? info?.event ?? "—";
                        const isTranslated = !!info?.translatedHeadline;
                        const lang = info?.detectedLanguage;
                        return (
                          <>
                            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                              {/* The headline IS the way into the alert's detail
                                  page — the row's obvious target, per the events
                                  table. The trailing Details button stays for the
                                  rows whose headline reads as plain text. */}
                              <MuiLink
                                component={Link}
                                href={`/admin/alerts/${rep.id}`}
                                variant="body2"
                                sx={{ fontWeight: 600 }}
                              >
                                {headline}
                              </MuiLink>
                              {isTranslated && lang && <LangTag lang={lang} title={`Machine-translated from "${lang}"`} />}
                            </Stack>
                            {info?.event && info.event !== headline && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                                {info.event}
                              </Typography>
                            )}
                            {isTranslated && info?.headline && info.headline !== headline && (
                              <Typography variant="caption" color="text.disabled" sx={{ display: "block", fontStyle: "italic" }}>
                                orig: {info.headline}
                              </Typography>
                            )}
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                      {(() => {
                        const iso2 = alertCountryCode(rep);
                        if (!iso2) return <Typography variant="body2" color="text.disabled">—</Typography>;
                        return (
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                            <Box component="span" aria-hidden>
                              {flagOf(iso2)}
                            </Box>
                            <Typography variant="body2">{alertCountryName(rep)}</Typography>
                          </Stack>
                        );
                      })()}
                    </TableCell>
                    <TableCell sx={{ verticalAlign: "top" }}>
                      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                        <span>{areaSummary(rep)}</span>
                        {/* Geocode-only alert: it names a region but carries no shape
                            (server-computed repPoint is absent). Flag it so the rows
                            with nothing to draw on the globe stand out. */}
                        {!rep.repPoint && (
                          <Box
                            component="span"
                            title="No position info — this alert ships no geometry (geocode-only)"
                            sx={{
                              px: 0.625,
                              borderRadius: 0.5,
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: 0.3,
                              color: "warning.main",
                              border: 1,
                              borderColor: "warning.main",
                              whiteSpace: "nowrap",
                            }}
                          >
                            NO GEO
                          </Box>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
                        {/* A multi-source group is the interesting case — accent it. */}
                        {g.sources.map((s) => (
                          <Chip key={s} label={s} color={g.sources.length > 1 ? "primary" : "default"} />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ verticalAlign: "top" }}>{rep.msgType}</TableCell>
                    <TableCell sx={{ verticalAlign: "top" }}>{translatedBadge(translationStatus(rep))}</TableCell>
                    <TableCell sx={{ verticalAlign: "top" }}>{expiresLabel(rep)}</TableCell>
                    <TableCell sx={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                        <Button
                          variant="outlined"
                          onClick={() => setDebugId(debugId === g.id ? null : g.id)}
                          aria-expanded={debugId === g.id}
                        >
                          {debugId === g.id ? "Hide" : multi ? `Debug (${g.members.length})` : "Debug"}
                        </Button>
                        <Button component={Link} href={`/admin/alerts/${rep.id}`} variant="outlined">
                          Details →
                        </Button>
                        {info?.web && (
                          <MuiLink href={info.web} target="_blank" rel="noreferrer" variant="body2">
                            link
                          </MuiLink>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={10}>
                  {loading
                    ? "Loading…"
                    : alerts.length
                      ? "No alerts match the current filters."
                      : "No alerts. Trigger an ingest or wait for the worker's tick."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {debugGroup && (() => {
        // Prefer the lazily-loaded full doc (raw description + geocodes); fall
        // back to the lean list row so the modal renders instantly, then fills
        // in when the fetch lands.
        const rep = fullById[debugGroup.representative.id] ?? debugGroup.representative;
        const membersFull = debugGroup.members.map((m) => fullById[m.id] ?? m);
        const info = primaryInfo(rep);
        const multi = debugGroup.members.length > 1;
        const loadingFull = debugGroup.members.some((m) => !fullById[m.id]);
        const h = hazardMeta(debugGroup.hazard);
        return (
          <Box
            role="dialog"
            aria-modal="true"
            onClick={() => setDebugId(null)}
            sx={{
              position: "fixed",
              inset: 0,
              bgcolor: alpha(surface.page, 0.8),
              display: "flex",
              alignItems: "stretch",
              justifyContent: "center",
              p: 3,
              zIndex: 1000,
            }}
          >
            <Paper
              onClick={(e) => e.stopPropagation()}
              sx={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: 1100, overflow: "hidden" }}
            >
              <Stack
                component="header"
                direction="row"
                spacing={1.5}
                sx={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  px: 2.25,
                  py: 1.5,
                  borderBottom: 1,
                  borderColor: "divider",
                  flexShrink: 0,
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                  <Typography variant="h3" sx={{ color: h.color }}>
                    {h.icon} {h.label}
                  </Typography>
                  <Typography variant="h3" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {info?.event ?? "—"}
                  </Typography>
                </Stack>
                <IconButton onClick={() => setDebugId(null)} aria-label="Close" size="small" sx={{ flexShrink: 0 }}>
                  ✕
                </IconButton>
              </Stack>
              {multi && (
                <Box sx={{ px: 2.25, py: 1.25, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
                  <Typography variant="body2" color="text.secondary">
                    {debugGroup.members.length} alerts from {debugGroup.sources.length} source
                    {debugGroup.sources.length === 1 ? "" : "s"} matched by overlapping area + hazard:
                  </Typography>
                  {debugGroup.members.map((m) => (
                    <Stack key={m.id} direction="row" spacing={0.75} sx={{ alignItems: "center", mt: 0.5, flexWrap: "wrap" }}>
                      <Chip label={m.source} />
                      <Typography variant="body2">
                        {primaryInfo(m)?.event} — {areaSummary(m)}
                      </Typography>
                      <MuiLink component={Link} href={`/admin/alerts/${m.id}`} variant="body2">
                        details
                      </MuiLink>
                    </Stack>
                  ))}
                </Box>
              )}
              {info && <TranslationDebugPanel info={info} />}
              {loadingFull && (
                <Typography variant="caption" color="text.disabled" sx={{ px: 2.25, py: 0.75, fontStyle: "italic", flexShrink: 0 }}>
                  loading full doc…
                </Typography>
              )}
              <Box
                component="pre"
                sx={{
                  m: 0,
                  px: 2.25,
                  py: 1.75,
                  bgcolor: surface.sunken,
                  color: "text.secondary",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  flex: 1,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(multi ? membersFull : rep, null, 2)}
              </Box>
            </Paper>
          </Box>
        );
      })()}
    </AdminPageShell>
  );
}

/** The "XX→EN" machine-translation tag shown beside a translated headline. */
function LangTag({ lang, title }: { lang: string; title?: string }) {
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: "inline-block",
        px: 0.625,
        borderRadius: 0.5,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.3,
        color: "primary.main",
        border: 1,
        borderColor: "primary.main",
      }}
    >
      {lang.toUpperCase()}→EN
    </Box>
  );
}

/** "Translated" (green) / "English source" (gray) / "Pending" (amber) — mirrors
 *  VolcanoesTable's wikiStatus() badge convention. */
function translatedBadge(status: "translated" | "english" | "pending") {
  const meta =
    status === "translated"
      ? { label: "Translated", color: "success.main" }
      : status === "english"
        ? { label: "English source", color: "text.secondary" }
        : { label: "Pending", color: "warning.main" };
  return (
    <Typography variant="body2" sx={{ color: meta.color }}>
      {meta.label}
    </Typography>
  );
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
    <Box sx={{ px: 2.25, py: 1.5, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <Typography variant="overline" color="text.secondary">
          Translation
        </Typography>
        {info.detectedLanguage ? (
          <LangTag lang={info.detectedLanguage} />
        ) : (
          <Typography variant="caption" color="text.disabled" sx={{ fontStyle: "italic" }}>
            not yet processed
          </Typography>
        )}
        {info.translatedAt && (
          <Typography variant="caption" color="text.disabled">
            <code>{new Date(info.translatedAt).toLocaleString()}</code>
          </Typography>
        )}
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "90px 1fr", rowGap: 1, columnGap: 1.25 }}>
        {rows.map((r) => (
          <Fragment key={r.label}>
            <Typography variant="caption" color="text.secondary">
              {r.label}
            </Typography>
            <Box>
              <Typography variant="caption" sx={{ display: "block" }}>
                {r.translated || r.original || "—"}
              </Typography>
              {r.translated && r.original && r.translated !== r.original && (
                <Typography variant="caption" color="text.disabled" sx={{ display: "block", fontStyle: "italic", mt: 0.25 }}>
                  orig: {r.original}
                </Typography>
              )}
            </Box>
          </Fragment>
        ))}
      </Box>
    </Box>
  );
}

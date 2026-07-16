"use client";

/**
 * /admin/summaries — the round-ups screen. Shows the latest scheduled global
 * weather-event summary per cadence (hourly / 12h / daily): the LLM narrative,
 * headline stats, geographic hotspots, top events, and a history list. The
 * worker generates these on a cron; "Generate now" triggers one on demand and a
 * Socket.IO `summaries:updated` event live-refreshes the view.
 */
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { SUMMARIES_UPDATED } from "@photonsurge/shared/control";
import { useSocket } from "../../../lib/socket-provider";
import { severityColor, severityLabel } from "../../../lib/alerts";
import { hazardMeta } from "../../../lib/hazard";
import {
  getSummaries,
  SUMMARY_PERIODS,
  type SummaryPeriod,
  type EventSummary,
} from "../../../lib/summaries";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { surface } from "../../../theme/tokens";

const fmtTime = (iso?: string | Date): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toUTCString().replace("GMT", "UTC");
};

export default function SummariesPage() {
  const { socket } = useSocket();
  const [period, setPeriod] = useState<SummaryPeriod>("hourly");
  const [latest, setLatest] = useState<EventSummary | null>(null);
  const [history, setHistory] = useState<EventSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSummaries(period, 20);
      setLatest(res.latest);
      setHistory(res.history);
      setSelectedId(res.latest?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Live refresh when the worker finishes a round-up for the current cadence.
  useEffect(() => {
    if (!socket) return;
    const onUpdate = (p: { period?: SummaryPeriod }) => {
      if (!p?.period || p.period === period) reload();
    };
    socket.on(SUMMARIES_UPDATED, onUpdate);
    return () => {
      socket.off(SUMMARIES_UPDATED, onUpdate);
    };
  }, [socket, period, reload]);

  const generateNow = useCallback(async () => {
    const meta = SUMMARY_PERIODS.find((p) => p.id === period);
    if (!meta) return;
    setGenMsg("Queuing…");
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: meta.jobId }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.ok) {
        setGenMsg(`Generating (job #${body.jobId})… refreshing in 10s`);
        setTimeout(() => {
          setGenMsg(null);
          reload();
        }, 10000);
      } else {
        setGenMsg(`Failed: ${body?.error ?? "queue unreachable"}`);
      }
    } catch (err) {
      setGenMsg(`Failed: ${String(err)}`);
    }
  }, [period, reload]);

  const shown = history.find((h) => h.id === selectedId) ?? latest;

  return (
    <AdminPageShell
      title="Round-ups"
      description="Scheduled global weather-event summaries and broadcast narrative."
      actions={
        <>
          <Stack direction="row" spacing={0.875} useFlexGap sx={{ flexWrap: "wrap" }}>
            {SUMMARY_PERIODS.map((p) => (
              <Chip
                key={p.id}
                label={p.label}
                onClick={() => setPeriod(p.id)}
                color={period === p.id ? "primary" : "default"}
                variant={period === p.id ? "filled" : "outlined"}
              />
            ))}
          </Stack>
          <Button variant="outlined" onClick={reload} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </Button>
          {/* The one genuinely primary action here — everything else is a view switch. */}
          <Button variant="contained" onClick={generateNow} disabled={!!genMsg}>
            Generate now
          </Button>
        </>
      }
    >
      {genMsg && (
        <Alert severity={genMsg.startsWith("Failed") ? "error" : "info"} sx={{ mb: 2 }}>
          {genMsg}
        </Alert>
      )}

      {!shown ? (
        <Typography color="text.secondary" sx={{ mt: 3 }}>
          {loading
            ? "Loading…"
            : "No round-up yet for this cadence. Click “Generate now” or wait for the worker's cron."}
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
            Generated {fmtTime(shown.generatedAt)} · window {fmtTime(shown.windowStart)} → {fmtTime(shown.windowEnd)}
            {shown.sources.length ? ` · sources: ${shown.sources.join(", ")}` : ""}
          </Typography>

          {/* Stats cards */}
          <Stack direction="row" spacing={1.75} useFlexGap sx={{ flexWrap: "wrap", mt: 2 }}>
            <StatCard label="Active alerts" value={shown.stats.alertsActive} />
            <StatCard label="Cyclones" value={shown.stats.cyclones} />
            <StatCard
              label="Earthquakes"
              value={shown.stats.quakeCount}
              sub={shown.stats.quakeMaxMag ? `max M${shown.stats.quakeMaxMag.toFixed(1)}` : undefined}
            />
            <StatCard
              label="Volcanoes"
              value={shown.stats.volcanoCount}
              sub={shown.stats.volcanoErupting ? `${shown.stats.volcanoErupting} erupting` : undefined}
            />
            <StatCard label="Notable tracks" value={shown.stats.tracksNotable} />
            <Paper sx={{ p: 1.75, flex: "1 1 260px" }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                Alerts by severity
              </Typography>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mt: 1 }}>
                {[4, 3, 2, 1, 0].map((r) => {
                  const n = shown.stats.alertsBySeverity[String(r)] ?? 0;
                  if (!n) return null;
                  return (
                    <Tooltip key={r} title={severityLabel(r as 0)}>
                      <Box component="span" sx={{ ...severityBadge, px: 1, bgcolor: severityColor(r as 0) }}>
                        {r} · {n}
                      </Box>
                    </Tooltip>
                  );
                })}
              </Stack>
            </Paper>
          </Stack>

          {/* Narrative */}
          <Paper sx={{ p: 1.75, mt: 2 }}>
            <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
              <Typography variant="overline" color="text.secondary">
                Broadcast round-up
              </Typography>
              <Typography variant="caption" color="text.disabled">
                {shown.narrativeStatus === "ok"
                  ? `narrative by ${shown.llm?.model ?? "LLM"}${shown.llm?.completionTokens ? ` · ${shown.llm.completionTokens} tok` : ""}`
                  : shown.narrativeStatus === "skipped"
                    ? "narrative skipped (no OPENROUTER_API_KEY)"
                    : `narrative error: ${shown.llm?.error ?? "unknown"}`}
              </Typography>
            </Stack>
            {shown.narrative ? (
              <Narrative text={shown.narrative} />
            ) : (
              <Typography variant="body2" color="text.disabled" sx={{ mt: 1.25, fontStyle: "italic" }}>
                No narrative — the deterministic stats, hotspots and top events below are still available.
              </Typography>
            )}
          </Paper>

          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 2, mt: 2 }}>
            {/* Hotspots */}
            <Paper sx={{ p: 1.75 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                Hotspots ({shown.hotspots.length})
              </Typography>
              <Box sx={{ mt: 1 }}>
                {shown.hotspots.slice(0, 12).map((hs, i) => (
                  <Stack
                    key={i}
                    direction="row"
                    spacing={1.25}
                    sx={{ alignItems: "flex-start", py: 0.75, borderTop: "1px solid", borderColor: "divider" }}
                  >
                    <Tooltip title={severityLabel(hs.maxSeverity)}>
                      <Box component="span" sx={{ ...severityBadge, bgcolor: severityColor(hs.maxSeverity) }}>
                        {hs.maxSeverity}
                      </Box>
                    </Tooltip>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {hs.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {hs.count} event{hs.count === 1 ? "" : "s"}
                        {hs.hazards.length ? ` · ${hs.hazards.map((h) => hazardMeta(h as "other").icon).join(" ")}` : ""}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
                {!shown.hotspots.length && (
                  <Typography variant="body2" color="text.disabled">
                    No hotspots.
                  </Typography>
                )}
              </Box>
            </Paper>

            {/* Top events */}
            <Paper sx={{ p: 1.75 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                Top events ({shown.topEvents.length})
              </Typography>
              <Table sx={{ mt: 1 }}>
                <TableBody>
                  {shown.topEvents.map((ev, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ verticalAlign: "top", width: 34, pl: 0 }}>
                        <Box component="span" sx={{ ...severityBadge, bgcolor: severityColor(ev.severity) }}>
                          {ev.severity}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ verticalAlign: "top", px: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {ev.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {ev.kind}
                          {ev.source ? ` · ${ev.source}` : ""}
                          {ev.at ? ` · ${fmtTime(ev.at)}` : ""}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!shown.topEvents.length && (
                    <TableRow>
                      <TableCell colSpan={2} sx={{ color: "text.disabled", pl: 0 }}>
                        No events.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </Box>

          {/* History */}
          {history.length > 1 && (
            <Paper sx={{ p: 1.75, mt: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                History
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 1 }}>
                {history.map((h) => (
                  <Chip
                    key={h.id}
                    label={`${fmtTime(h.generatedAt)} · ${h.hotspots.length} hs`}
                    onClick={() => setSelectedId(h.id)}
                    color={h.id === selectedId ? "primary" : "default"}
                    variant={h.id === selectedId ? "filled" : "outlined"}
                  />
                ))}
              </Stack>
            </Paper>
          )}
        </>
      )}
    </AdminPageShell>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Paper sx={{ p: 1.75, flex: "1 1 150px" }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      {/* A count is a reading — mono, tabular (DESIGN_BIBLE §3). */}
      <Typography component="code" sx={{ display: "block", fontSize: 28, fontWeight: 700, mt: 0.5 }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

/**
 * The narrative is prose written for an anchor to read, not a reading — so it
 * stays in the sans face despite sitting in a `<pre>` (which is only there to
 * honour the LLM's own line breaks).
 */
function Narrative({ text }: { text: string }) {
  return (
    <Typography
      component="pre"
      sx={{
        m: 0,
        mt: 1.25,
        p: "12px 14px",
        bgcolor: surface.sunken,
        color: "text.primary",
        fontFamily: "inherit",
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        borderRadius: 1,
      }}
    >
      {text}
    </Typography>
  );
}

/**
 * The severity swatch. The background is spread in per-rank at each use site
 * from the §4.4 ramp — the ink is `page` rather than a light tone because every
 * rank on that ramp is a saturated fill.
 */
const severityBadge = {
  display: "inline-block",
  minWidth: 22,
  textAlign: "center",
  borderRadius: 0.75,
  py: 0.25,
  fontSize: 12,
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  color: surface.page,
  flexShrink: 0,
} as const;

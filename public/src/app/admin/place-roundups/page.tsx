"use client";

/**
 * /admin/place-roundups — the per-country / per-region AI round-ups screen.
 * Left: the places that have a round-up (latest per place) for the selected
 * kind. Right: the chosen place's LLM narrative, the exact inputs it was built
 * from (top cities + capital, area-weather, alerts, volcanoes, gauges), and a
 * history strip. "Generate now" enqueues the matching worker job; a Socket.IO
 * `placeRoundups:updated` event live-refreshes the view. Countries opt in via
 * the toggle on /countries; regions always generate. The Schedule card at the
 * top chooses which kinds run and at which local hours.
 */
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { PLACE_ROUNDUPS_UPDATED } from "@photonsurge/shared/control";
import { useSocket } from "../../../lib/socket-provider";
import {
  getPlaceRoundups,
  getPlaceRoundupDetail,
  PLACE_ROUNDUP_KINDS,
  type PlaceRoundup,
  type PlaceRoundupKind,
} from "../../../lib/placeRoundups";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import RoundupScheduleCard from "../../../components/admin/roundups/RoundupScheduleCard";
import { font, surface } from "../../../theme/tokens";

const fmtTime = (iso?: string | Date): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toUTCString().replace("GMT", "UTC");
};
const num = (v?: number, digits = 0): string => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—");
/** Narrative health on the product's own status semantics, not a private scheme. */
const statusColor = (s: PlaceRoundup["narrativeStatus"]) =>
  s === "ok" ? "success.main" : s === "skipped" ? "text.secondary" : "error.main";

export default function PlaceRoundupsPage() {
  const { socket } = useSocket();
  const [kind, setKind] = useState<PlaceRoundupKind>("country");
  const [places, setPlaces] = useState<PlaceRoundup[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [latest, setLatest] = useState<PlaceRoundup | null>(null);
  const [history, setHistory] = useState<PlaceRoundup[]>([]);
  const [shownId, setShownId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getPlaceRoundups(kind);
      setPlaces(res.places);
      setPlaceId((cur) => cur ?? res.places[0]?.placeId ?? null);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  const loadDetail = useCallback(async () => {
    if (!placeId) {
      setLatest(null);
      setHistory([]);
      return;
    }
    const res = await getPlaceRoundupDetail(kind, placeId);
    setLatest(res.latest);
    setHistory(res.history);
    setShownId(res.latest?.id ?? null);
  }, [kind, placeId]);

  // Reset the selection when switching kinds so the first place of the new kind wins.
  useEffect(() => {
    setPlaceId(null);
  }, [kind]);
  useEffect(() => {
    loadIndex();
  }, [loadIndex]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Live refresh when the worker finishes a round-up for this kind.
  useEffect(() => {
    if (!socket) return;
    const onUpdate = (p: { placeKind?: PlaceRoundupKind; placeId?: string }) => {
      if (p?.placeKind && p.placeKind !== kind) return;
      loadIndex();
      if (!p?.placeId || p.placeId === placeId) loadDetail();
    };
    socket.on(PLACE_ROUNDUPS_UPDATED, onUpdate);
    return () => {
      socket.off(PLACE_ROUNDUPS_UPDATED, onUpdate);
    };
  }, [socket, kind, placeId, loadIndex, loadDetail]);

  const generateNow = useCallback(async () => {
    const meta = PLACE_ROUNDUP_KINDS.find((k) => k.id === kind);
    if (!meta) return;
    setGenMsg("Queuing…");
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: meta.jobId }),
      });
      const body = await res.json().catch(() => ({}));
      setGenMsg(
        body?.ok
          ? `Generating (job #${body.jobId})… live-refreshes as each place lands.`
          : `Failed: ${body?.error ?? "queue unreachable"}`,
      );
      if (body?.ok) setTimeout(() => setGenMsg(null), 8000);
    } catch (err) {
      setGenMsg(`Failed: ${String(err)}`);
    }
  }, [kind]);

  const shown = history.find((h) => h.id === shownId) ?? latest;

  return (
    <AdminPageShell
      title="Place round-ups"
      description="Per-country and per-region AI round-ups — each written with the previous one in view."
      maxWidth={1500}
      actions={
        <>
          <Stack direction="row" spacing={0.875} useFlexGap sx={{ flexWrap: "wrap" }}>
            {PLACE_ROUNDUP_KINDS.map((k) => (
              <Chip
                key={k.id}
                label={k.label}
                onClick={() => setKind(k.id)}
                color={kind === k.id ? "primary" : "default"}
                variant={kind === k.id ? "filled" : "outlined"}
              />
            ))}
          </Stack>
          <Button variant="outlined" onClick={loadIndex} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </Button>
          {/* The one genuinely primary action here — everything else is a view switch. */}
          <Button variant="contained" onClick={generateNow} disabled={!!genMsg}>
            Generate now
          </Button>
        </>
      }
    >
      <RoundupScheduleCard ids={["place-country", "place-region"]} />

      {genMsg && (
        <Alert severity={genMsg.startsWith("Failed") ? "error" : "info"} sx={{ mb: 1 }}>
          {genMsg}
        </Alert>
      )}

      <Stack direction="row" spacing={2} useFlexGap sx={{ mt: 1.75, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Places list */}
        <Paper sx={{ p: 1.75, flex: "0 0 300px", maxHeight: "72vh", overflowY: "auto" }}>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
            {kind === "country" ? "Countries" : "Regions"} ({places.length})
          </Typography>
          <Box sx={{ mt: 1 }}>
            {places.map((p) => (
              <ButtonBase
                key={p.placeId}
                onClick={() => setPlaceId(p.placeId)}
                sx={{
                  display: "flex",
                  gap: 1,
                  alignItems: "center",
                  justifyContent: "flex-start",
                  width: "100%",
                  textAlign: "left",
                  px: 1,
                  py: 0.875,
                  mt: 0.5,
                  borderRadius: 1,
                  border: "1px solid",
                  fontSize: 13,
                  borderColor: p.placeId === placeId ? "primary.main" : "divider",
                  bgcolor: p.placeId === placeId ? surface.raised : surface.sunken,
                }}
              >
                <Box
                  component="span"
                  sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: statusColor(p.narrativeStatus) }}
                />
                <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </Box>
                <Typography component="code" variant="caption" color="text.disabled">
                  {p.inputs?.alertsTotal ?? p.inputs?.alerts?.length ?? 0}⚠
                </Typography>
              </ButtonBase>
            ))}
            {!places.length && (
              <Typography variant="body2" color="text.disabled" sx={{ p: 0.75 }}>
                {loading ? "Loading…" : `No round-ups yet. ${kind === "country" ? "Enable a country on /countries, then " : ""}click “Generate now”.`}
              </Typography>
            )}
          </Box>
        </Paper>

        {/* Detail */}
        <Box sx={{ flex: "1 1 520px", minWidth: 320 }}>
          {!shown ? (
            <Typography color="text.secondary" sx={{ p: 2.5 }}>
              Select a place to see its round-up.
            </Typography>
          ) : (
            <>
              <Stack direction="row" spacing={1} useFlexGap sx={{ justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap" }}>
                <Typography variant="h1" component="h2">
                  {shown.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Generated {fmtTime(shown.generatedAt)}
                  {shown.prevRoundupId ? " · continues previous" : " · first round-up"}
                </Typography>
              </Stack>

              {/* Narrative */}
              <Paper sx={{ p: 1.75, mt: 1.5 }}>
                <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="overline" color="text.secondary">
                    Broadcast round-up
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {shown.narrativeStatus === "ok"
                      ? `by ${shown.llm?.model ?? "LLM"}${shown.llm?.completionTokens ? ` · ${shown.llm.completionTokens} tok` : ""}`
                      : shown.narrativeStatus === "skipped"
                        ? "skipped (no OPENROUTER_API_KEY)"
                        : `error: ${shown.llm?.error ?? "unknown"}`}
                  </Typography>
                </Stack>
                {shown.narrative ? (
                  <Narrative text={shown.narrative} />
                ) : (
                  <Typography variant="body2" color="text.disabled" sx={{ mt: 1.25, fontStyle: "italic" }}>
                    No narrative — the deterministic inputs below are still stored.
                  </Typography>
                )}
              </Paper>

              {/* Inputs the LLM saw */}
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 1.75, mt: 1.75 }}>
                {/* Cities */}
                <Paper sx={{ p: 1.75 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    City conditions ({shown.inputs?.topCities?.length ?? 0})
                  </Typography>
                  <Table sx={{ mt: 1 }}>
                    <TableBody>
                      {(shown.inputs?.topCities ?? []).map((c, i) => (
                        <TableRow key={i}>
                          <TableCell sx={{ pl: 0, fontWeight: 600 }}>
                            {c.isCapital ? "★ " : ""}
                            {c.name}
                          </TableCell>
                          <TableCell sx={numCell}>{num(c.temp)}°C</TableCell>
                          <TableCell sx={numCell}>{num(c.wind)} m/s</TableCell>
                          <TableCell sx={numCell}>{c.hi != null || c.lo != null ? `${num(c.hi)}/${num(c.lo)}` : "—"}</TableCell>
                        </TableRow>
                      ))}
                      {!(shown.inputs?.topCities ?? []).length && (
                        <TableRow>
                          <TableCell colSpan={4} sx={emptyCell}>
                            No cached city weather.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Paper>

                {/* Area weather */}
                <Paper sx={{ p: 1.75 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    Area weather
                  </Typography>
                  <Table sx={{ mt: 1 }}>
                    <TableBody>
                      {(shown.inputs?.area?.stats ?? []).map((s, i) => (
                        <TableRow key={i}>
                          <TableCell sx={{ pl: 0, fontWeight: 600 }}>{s.variable}</TableCell>
                          <TableCell sx={numCell}>
                            μ {num(s.mean, 1)}
                            {s.units}
                          </TableCell>
                          <TableCell sx={numCell}>
                            {num(s.min, 1)}–{num(s.max, 1)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {!(shown.inputs?.area?.stats ?? []).length && (
                        <TableRow>
                          <TableCell colSpan={3} sx={emptyCell}>
                            No area-weather snapshot yet.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                  {!!(shown.inputs?.area?.hazards ?? []).length && (
                    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mt: 1 }}>
                      {shown.inputs!.area!.hazards.map((h, i) => (
                        <Chip key={i} label={h.label} sx={{ color: "warning.main" }} />
                      ))}
                    </Stack>
                  )}
                </Paper>

                {/* Alerts */}
                <Paper sx={{ p: 1.75 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    Active alerts ({shown.inputs?.alerts?.length ?? 0}
                    {shown.inputs?.alertsTotal && shown.inputs.alertsTotal > (shown.inputs.alerts?.length ?? 0)
                      ? ` of ${shown.inputs.alertsTotal}`
                      : ""}
                    )
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    {(shown.inputs?.alerts ?? []).slice(0, 20).map((a, i) => (
                      <Box key={i} sx={{ py: 0.5, borderTop: i ? "1px solid" : undefined, borderColor: "divider" }}>
                        <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
                          {a.event}
                        </Typography>
                        <Typography variant="body2" component="span" color="text.secondary">
                          {" "}
                          · sev {a.severityRank}
                          {a.hazard ? ` · ${a.hazard}` : ""}
                          {a.source ? ` · ${a.source}` : ""}
                        </Typography>
                      </Box>
                    ))}
                    {!(shown.inputs?.alerts ?? []).length && (
                      <Typography variant="body2" color="text.disabled">
                        None active.
                      </Typography>
                    )}
                  </Box>
                </Paper>

                {/* Volcanoes + gauges */}
                <Paper sx={{ p: 1.75 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    Volcanoes &amp; gauges
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    {(shown.inputs?.volcanoes ?? []).map((v, i) => (
                      <Typography key={`v${i}`} variant="body2" sx={{ py: 0.375 }}>
                        🌋 {v.name} · {v.status}
                      </Typography>
                    ))}
                    {(shown.inputs?.tideGauges ?? []).map((g, i) => (
                      <Typography key={`t${i}`} variant="body2" sx={{ py: 0.375 }}>
                        🌊 {g.name} · {num(g.latest, 2)} m{g.distanceKm != null ? ` · ${g.distanceKm} km` : ""}
                      </Typography>
                    ))}
                    {(shown.inputs?.seismoStations ?? []).map((g, i) => (
                      <Typography key={`s${i}`} variant="body2" sx={{ py: 0.375 }}>
                        📈 {g.name}
                        {g.distanceKm != null ? ` · ${g.distanceKm} km` : ""}
                      </Typography>
                    ))}
                    {!(shown.inputs?.volcanoes ?? []).length &&
                      !(shown.inputs?.tideGauges ?? []).length &&
                      !(shown.inputs?.seismoStations ?? []).length && (
                        <Typography variant="body2" color="text.disabled">
                          None in range.
                        </Typography>
                      )}
                  </Box>
                </Paper>
              </Box>

              {/* History */}
              {history.length > 1 && (
                <Paper sx={{ p: 1.75, mt: 1.75 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    History
                  </Typography>
                  <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 1 }}>
                    {history.map((h) => (
                      <Chip
                        key={h.id}
                        label={fmtTime(h.generatedAt)}
                        onClick={() => setShownId(h.id)}
                        color={h.id === shownId ? "primary" : "default"}
                        variant={h.id === shownId ? "filled" : "outlined"}
                      />
                    ))}
                  </Stack>
                </Paper>
              )}
            </>
          )}
        </Box>
      </Stack>
    </AdminPageShell>
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

/** Measurements, so mono + tabular (DESIGN_BIBLE §3) — the columns must align. */
const numCell = { py: 0.625, px: 0, textAlign: "right", color: "text.secondary", fontFamily: font.mono, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const emptyCell = { color: "text.disabled", pl: 0 } as const;

"use client";

/**
 * /admin/archive — one UTC day of the permanent record.
 *
 * Retention keeps a deliberate daily sample rather than everything forever
 * (docs/blob-retention-plan.md): one weather frame per model and variable per
 * day, one alert still per alert per day, and every significant earthquake.
 * This page is what makes that sample worth keeping — pick a day and see the
 * maps as they were, what was warned about, what shook, and what aired.
 */
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { font, surface } from "../../../theme/tokens";

interface FrameRow {
  id: string;
  model: string;
  validTime: string;
  fhr: number;
  url: string;
}
interface MapGroup {
  variable: string;
  frames: FrameRow[];
}
interface AlertRow {
  id: string;
  source: string;
  identifier: string;
  severityRank: number;
  sent: string | null;
  expires: string | null;
  event: string;
  headline: string;
  area: string;
}
interface QuakeRow {
  quakeId: string;
  mag: number;
  place: string;
  time: string;
  depthKm: number;
  url?: string;
  tsunami: boolean;
}
interface DayArchive {
  date: string;
  maps: MapGroup[];
  mapCount: number;
  alerts: AlertRow[];
  quakes: QuakeRow[];
  aired: { cuts: number; counts: Record<string, number>; first: string | null; last: string | null };
  at: string;
}

/** DESIGN_BIBLE §3: times, magnitudes and counts are readings — mono, tabular. */
const reading = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" } as const;

const todayUtc = () => new Date().toISOString().slice(0, 10);
const shiftDay = (date: string, days: number) =>
  new Date(+new Date(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const hhmm = (iso: string | null) => (iso ? iso.slice(11, 16) : "—");

const SEVERITY_LABEL = ["Unknown", "Minor", "Moderate", "Severe", "Extreme"];
const severityColor = (rank: number) =>
  rank >= 4 ? "error" : rank >= 3 ? "warning" : rank >= 2 ? "info" : "default";

export default function ArchivePage() {
  const [date, setDate] = useState(todayUtc);
  const [day, setDay] = useState<DayArchive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/archive?date=${d}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setDay(body);
      setError(null);
    } catch (err: any) {
      setError(err?.message || String(err));
      setDay(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const isToday = date >= todayUtc();

  return (
    <AdminPageShell
      title="Archive"
      crumbs={[{ href: "/admin", label: "Admin" }]}
      maxWidth={1280}
      description={
        <>
          One UTC day of the permanent record. Retention keeps a daily sample rather than everything
          forever, so this is the day as it was kept: one map per model and variable, the warnings in
          force, every significant earthquake, and what went to air. See{" "}
          <MuiLink href="/admin/files">Files</MuiLink> for what that costs on disk.
        </>
      }
      actions={
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Button size="small" onClick={() => setDate((d) => shiftDay(d, -1))}>
            ← Previous
          </Button>
          <TextField
            size="small"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayUtc())}
            sx={{ width: 170 }}
          />
          <Button size="small" disabled={isToday} onClick={() => setDate((d) => shiftDay(d, 1))}>
            Next →
          </Button>
          <Button size="small" onClick={() => load(date)}>
            Refresh
          </Button>
        </Stack>
      }
    >
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {loading && !day && (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", py: 4 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Reading {date}…</Typography>
        </Stack>
      )}

      {day && (
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Chip size="small" label={`${day.mapCount} map frame${day.mapCount === 1 ? "" : "s"}`} />
            <Chip size="small" label={`${day.alerts.length} alert${day.alerts.length === 1 ? "" : "s"} in force`} />
            <Chip size="small" label={`${day.quakes.length} earthquake${day.quakes.length === 1 ? "" : "s"}`} />
            <Chip size="small" label={`${day.aired.cuts} cut${day.aired.cuts === 1 ? "" : "s"} aired`} />
          </Stack>

          {/* --- maps ------------------------------------------------------- */}
          <Paper variant="outlined" sx={{ p: 2, bgcolor: surface.raised }}>
            <Typography variant="h6" gutterBottom>
              Maps
            </Typography>
            {day.maps.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No frames kept for this day. Either nothing was ingested, or the day predates the
                archive.
              </Typography>
            ) : (
              <Stack spacing={2}>
                {day.maps.map((group) => (
                  <Box key={group.variable}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5, textTransform: "capitalize" }}>
                      {group.variable}
                    </Typography>
                    <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                      {group.frames.map((f) => (
                        <Box key={f.id} sx={{ width: 220 }}>
                          <MuiLink href={f.url} target="_blank" rel="noreferrer">
                            <Box
                              component="img"
                              src={f.url}
                              alt={`${group.variable} ${f.model} ${f.validTime}`}
                              loading="lazy"
                              sx={{
                                width: "100%",
                                aspectRatio: "2 / 1",
                                objectFit: "cover",
                                borderRadius: 1,
                                border: "1px solid",
                                borderColor: "divider",
                                bgcolor: "background.default",
                              }}
                            />
                          </MuiLink>
                          <Typography variant="caption" sx={{ ...reading, display: "block" }}>
                            {f.model} · {hhmm(f.validTime)}Z
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>

          {/* --- alerts ----------------------------------------------------- */}
          <Paper variant="outlined" sx={{ p: 2, bgcolor: surface.raised }}>
            <Typography variant="h6" gutterBottom>
              Warnings in force
            </Typography>
            {day.alerts.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing was in force on this day.
              </Typography>
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Severity</TableCell>
                      <TableCell>Event</TableCell>
                      <TableCell>Area</TableCell>
                      <TableCell>Source</TableCell>
                      <TableCell align="right">Sent</TableCell>
                      <TableCell align="right">Expires</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {day.alerts.map((a) => (
                      <TableRow key={a.id} hover>
                        <TableCell>
                          <Chip
                            size="small"
                            color={severityColor(a.severityRank) as any}
                            label={SEVERITY_LABEL[a.severityRank] ?? a.severityRank}
                          />
                        </TableCell>
                        <TableCell>
                          <MuiLink href={`/admin/alerts/${a.id}`}>{a.event || a.headline || a.identifier}</MuiLink>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 320 }}>{a.area}</TableCell>
                        <TableCell sx={reading}>{a.source}</TableCell>
                        <TableCell align="right" sx={reading}>
                          {hhmm(a.sent)}
                        </TableCell>
                        <TableCell align="right" sx={reading}>
                          {hhmm(a.expires)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Paper>

          {/* --- seismic ---------------------------------------------------- */}
          <Paper variant="outlined" sx={{ p: 2, bgcolor: surface.raised }}>
            <Typography variant="h6" gutterBottom>
              Earthquakes
            </Typography>
            {day.quakes.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing on record for this day. The permanent record only holds events above the
                archive magnitude floor, and only from the day archiving was first run.
              </Typography>
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell align="right">Mag</TableCell>
                      <TableCell>Place</TableCell>
                      <TableCell align="right">Depth</TableCell>
                      <TableCell align="right">Time</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {day.quakes.map((q) => (
                      <TableRow key={q.quakeId} hover>
                        <TableCell align="right" sx={reading}>
                          {q.mag.toFixed(1)}
                          {q.tsunami ? " ⚠" : ""}
                        </TableCell>
                        <TableCell>
                          {q.url ? (
                            <MuiLink href={q.url} target="_blank" rel="noreferrer">
                              {q.place}
                            </MuiLink>
                          ) : (
                            q.place
                          )}
                        </TableCell>
                        <TableCell align="right" sx={reading}>
                          {Math.round(q.depthKm)} km
                        </TableCell>
                        <TableCell align="right" sx={reading}>
                          {hhmm(q.time)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Paper>

          {/* --- as-run ----------------------------------------------------- */}
          <Paper variant="outlined" sx={{ p: 2, bgcolor: surface.raised }}>
            <Typography variant="h6" gutterBottom>
              On air
            </Typography>
            {day.aired.cuts === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nothing aired on this day.
              </Typography>
            ) : (
              <Stack spacing={1}>
                <Typography variant="body2" sx={reading}>
                  {day.aired.cuts} cuts, {hhmm(day.aired.first)} to {hhmm(day.aired.last)} UTC
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                  {Object.entries(day.aired.counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([kind, n]) => (
                      <Chip key={kind} size="small" variant="outlined" label={`${kind} ${n}`} />
                    ))}
                </Stack>
                <MuiLink href="/admin/runs" variant="body2">
                  Full as-run log →
                </MuiLink>
              </Stack>
            )}
          </Paper>
        </Stack>
      )}
    </AdminPageShell>
  );
}

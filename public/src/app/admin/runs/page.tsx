"use client";

/**
 * /admin/runs — the director's as-run sessions. One row per auto-director
 * session (scene entered auto → left auto); click through for the full cut
 * timeline. Live sessions keep updating, so the list re-polls while one is on.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { useTableSort } from "../../../components/admin/useTableSort";
import {
  fmtDuration,
  kindColor,
  listRuns,
  runDurationMs,
  runIsLive,
  type AirRun,
} from "../../../lib/airlog";
import { font } from "../../../theme/tokens";

const POLL_MS = 10_000;

/** DESIGN_BIBLE §3: start stamps, durations and cut counts are readings. */
const reading = { fontFamily: font.mono, fontVariantNumeric: "tabular-nums" } as const;

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

export default function RunsPage() {
  const [runs, setRuns] = useState<AirRun[]>([]);
  const [sceneNames, setSceneNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const res = await listRuns();
    setRuns(res.runs);
    setSceneNames(res.sceneNames);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // A live session grows every cut — keep the list fresh while one is on air.
  const anyLive = runs.some((r) => runIsLive(r));
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [anyLive, reload]);
  const sorted = useTableSort(runs, {
    status: (r) => runIsLive(r),
    scene: (r) => sceneNames[r.sceneId] ?? r.sceneId,
    started: (r) => r.startedAt,
    duration: (r) => runDurationMs(r),
    cuts: (r) => r.cuts,
    mix: (r) => Object.keys(r.kindCounts ?? {}).length,
  }, "started", true);

  return (
    <AdminPageShell
      title="Runs"
      description="What the auto-director actually aired — one session per scene, with the full shot-by-shot timeline inside."
      actions={
        <Button variant="outlined" onClick={reload}>
          Refresh
        </Button>
      }
    >
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>{sorted.header("status", "Status")}</TableCell>
            <TableCell>{sorted.header("scene", "Scene")}</TableCell>
            <TableCell>{sorted.header("started", "Started")}</TableCell>
            <TableCell>{sorted.header("duration", "Duration")}</TableCell>
            <TableCell>{sorted.header("cuts", "Cuts")}</TableCell>
            <TableCell>{sorted.header("mix", "Mix")}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.rows.map((r) => {
            const live = runIsLive(r);
            return (
              <TableRow key={r.id}>
                <TableCell sx={{ verticalAlign: "top" }}>
                  {live ? (
                    <Typography variant="caption" sx={{ color: "error.main", fontWeight: 700, letterSpacing: 0.5 }}>
                      ● LIVE
                    </Typography>
                  ) : (
                    <Typography variant="caption" color="text.disabled">
                      {r.endReason === "stale" ? "orphaned" : r.endedAt ? "ended" : "stalled"}
                    </Typography>
                  )}
                </TableCell>
                <TableCell sx={{ verticalAlign: "top", fontWeight: 600 }}>{sceneNames[r.sceneId] ?? r.sceneId}</TableCell>
                <TableCell sx={{ ...reading, verticalAlign: "top", whiteSpace: "nowrap" }}>{fmtTime(r.startedAt)}</TableCell>
                <TableCell sx={{ ...reading, verticalAlign: "top", whiteSpace: "nowrap" }}>{fmtDuration(runDurationMs(r))}</TableCell>
                <TableCell sx={{ ...reading, verticalAlign: "top" }}>{r.cuts}</TableCell>
                <TableCell sx={{ verticalAlign: "top" }}>
                  {/*
                    The kind colours come from lib/airlog's shared KIND_COLORS —
                    a categorical scale the timeline rail also reads, so the chip
                    and the dot on /admin/runs/:id agree on what "quake" looks
                    like. That's data, not a per-page palette.
                  */}
                  <Stack direction="row" spacing={0.625} useFlexGap sx={{ flexWrap: "wrap" }}>
                    {Object.entries(r.kindCounts ?? {})
                      .sort((a, b) => b[1] - a[1])
                      .map(([kind, n]) => (
                        <Chip
                          key={kind}
                          label={`${kind} · ${n}`}
                          sx={{ color: kindColor(kind), borderColor: `${kindColor(kind)}55` }}
                        />
                      ))}
                  </Stack>
                </TableCell>
                <TableCell sx={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                  <MuiLink component={Link} href={`/admin/runs/${r.id}`} variant="body2">
                    Timeline →
                  </MuiLink>
                </TableCell>
              </TableRow>
            );
          })}
          {runs.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <Box component="span" sx={{ color: "text.secondary" }}>
                  {loading
                    ? "Loading…"
                    : "No runs recorded yet. Put the director into auto on /control — the first cut opens a run."}
                </Box>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </AdminPageShell>
  );
}

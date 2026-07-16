"use client";

/**
 * One triggerable job on /admin/jobs. Cards sit in a grid inside their group's
 * panel, so they take the `raised` step of the surface ramp — page → panel →
 * card — which is what makes a card read as an object rather than a region of
 * the panel behind it.
 *
 * The description is shown in full: several of these carry real operating
 * caveats ("run the dry run first", "run the migration first", "needs X_API_KEY")
 * and an operator about to reseed a collection must see them without a hover.
 */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { TriggerableJob } from "@photonsurge/shared/jobs";
import { surface } from "../../../theme/tokens";

export interface Result {
  ok: boolean;
  jobId?: string;
  error?: string;
  at: string;
  /** Live BullMQ state once we start polling the enqueued job. */
  state?: string;
  /** How long the handler has run / ran, in ms. */
  durationMs?: number | null;
  failedReason?: string | null;
}

export interface StopResult {
  ok: boolean;
  removed?: number;
  error?: string;
  at: string;
}

/**
 * ms → "840ms" / "3.2s" / "1m4s".
 *
 * Both thresholds are the ROUNDED value, not the raw one, so the seconds can
 * never read as 60: 59_999ms is "1m0s" rather than a "60.0s" that never rolls,
 * and the minutes are taken from whole rounded seconds so a 119_500ms remainder
 * carries into the minute instead of printing "1m60s".
 */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  // 59_950ms+ rounds to 60.0s — past here it's a minute, not a second count.
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)}s`;
  const secs = Math.round(ms / 1000);
  return `${Math.floor(secs / 60)}m${secs % 60}s`;
}

/** The one-line status + palette colour for a triggered job's result row. */
export function resultLine(r: Result): { text: string; color: string } {
  if (!r.ok) return { text: `failed: ${r.error}`, color: "error.main" };
  const d = typeof r.durationMs === "number" ? fmtDuration(r.durationMs) : null;
  switch (r.state) {
    case "completed":
      return { text: d ? `done in ${d}` : "done", color: "success.main" };
    case "failed":
      return { text: `failed after ${d ?? "?"}${r.failedReason ? `: ${r.failedReason}` : ""}`, color: "error.main" };
    case "active":
      return { text: d ? `running… ${d}` : "running…", color: "warning.main" };
    case "unknown":
      // Reaped after completion (admin jobs kept 1h) or never landed — best-effort.
      return { text: `queued (#${r.jobId})`, color: "text.secondary" };
    default:
      return { text: `queued (#${r.jobId})`, color: "text.secondary" };
  }
}

interface JobCardProps {
  job: TriggerableJob;
  result?: Result;
  stopResult?: StopResult;
  running: boolean;
  stopping: boolean;
  onRun: () => void;
  onStop: () => void;
}

export default function JobCard({ job, result, stopResult, running, stopping, onRun, onStop }: JobCardProps) {
  const active = result?.state === "active";

  return (
    <Paper
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        p: 1.75,
        bgcolor: surface.raised,
        // A running job is the one thing on this page worth spotting from across
        // the room, so it gets the accent edge.
        borderColor: active ? "primary.main" : "divider",
      }}
    >
      <Typography variant="h3">{job.label}</Typography>

      <Typography variant="body2" color="text.secondary">
        {job.description}
      </Typography>

      {/* Push the actions to the card's foot so a grid row's buttons line up. */}
      <Box sx={{ flex: 1, minHeight: 4 }} />

      {result && (() => {
        const line = resultLine(result);
        return (
          <Typography variant="caption" color={line.color}>
            {line.text} · {new Date(result.at).toLocaleTimeString()}
          </Typography>
        );
      })()}
      {stopResult && (
        <Typography variant="caption" color={stopResult.ok ? "success.main" : "error.main"}>
          {stopResult.ok ? `stopped — ${stopResult.removed ?? 0} queued batch(es) removed` : `failed: ${stopResult.error}`} ·{" "}
          {new Date(stopResult.at).toLocaleTimeString()}
        </Typography>
      )}

      <Stack direction="row" spacing={1}>
        {/*
          Outlined, not contained. There are ~78 of these on the page: a filled
          accent on every one turns the accent into the background and leaves the
          eye nowhere to land. Quiet by default (DESIGN_BIBLE §5.6) — the accent
          is spent on the running card's border instead, which is the thing worth
          spotting from across the room.
        */}
        <Button variant="outlined" onClick={onRun} disabled={running} sx={{ flex: 1 }}>
          {running ? "…" : "Run now"}
        </Button>
        {job.stoppable && (
          <Button variant="outlined" color="error" onClick={onStop} disabled={stopping}>
            {stopping ? "…" : "Stop"}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

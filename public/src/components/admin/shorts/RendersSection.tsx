"use client";

/**
 * The Renders section on /admin/shorts (docs/short-video-plan.md §6.7). A
 * render is a Run, so this reads the way the runs list on /admin/streams
 * does: a status badge per video, the OBS / YouTube health readout on the
 * live one (the same RunStats, fed by the same socket events), Watch and the
 * as-run page.
 *
 * Grouped by queue: one header per video encoder (and per other encoder or
 * the "any" pool with videos in it), with Pause / Resume — a paused queue
 * finishes the live video and starts nothing new. Under it, the video on air
 * and the videos waiting, in order. Then the recent renders with their
 * outcome and reason.
 *
 * Controls: Stop (the live row: it ends now, fails, the queue moves on),
 * Cancel (a queued row), Retry (a failed, skipped or cancelled row).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { ANY_ENCODER, renderCanRetry, renderIsActive, renderIsFinished } from "@photonsurge/shared/short-render";
import type { RunState, StreamHealth } from "@photonsurge/shared/runs";
import RunStats from "../streams/RunStats";
import type { YoutubeVideoStats } from "../../../lib/stream";
import {
  queuePositions,
  renderStatus,
  type RenderAction,
  type RenderQueueRow,
  type RenderRow,
  type RendersResponse,
} from "../../../lib/renders";

interface Props {
  data: RendersResponse | null;
  error?: string | null;
  /** Live runs from the socket (fresher than the list's), by id. */
  runs?: Record<string, RunState>;
  health?: Record<string, StreamHealth>;
  /** YouTube views / likes per run id (the streams page's stats poll). */
  youtubeStats?: Record<string, YoutubeVideoStats>;
  statsError?: string | null;
  onAction: (a: RenderAction) => Promise<{ ok: boolean; error?: string }>;
  /** Show only this batch's renders (a schedule row's "Show its renders", §8). */
  batchId?: string | null;
  onClearBatch?: () => void;
  /** Injectable for tests. */
  now?: () => number;
}

/** A clock that ticks each second while `on`. */
function useNow(on: boolean, now: () => number): number {
  const [t, setT] = useState(now);
  useEffect(() => {
    if (!on) return;
    setT(now());
    const id = setInterval(() => setT(now()), 1000);
    return () => clearInterval(id);
  }, [on, now]);
  return on ? t : now();
}

/** The queue a row shows under: the encoder working on it, else the one it waits for. */
const groupKey = (r: RenderRow) =>
  (renderIsActive(r.status) ? (r.assignedEncoderId ?? r.encoderId) : r.encoderId) || ANY_ENCODER;

const fmtWhen = (ms?: number) =>
  ms ? new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export default function RendersSection({
  data,
  error,
  runs = {},
  health = {},
  youtubeStats = {},
  statsError,
  onAction,
  batchId,
  onClearBatch,
  now = Date.now,
}: Props) {
  const all = data?.renders ?? [];
  const renders = batchId ? all.filter((r) => r.batchId === batchId) : all;
  const anyLive = renders.some((r) => renderIsActive(r.status));
  const t = useNow(anyLive, now);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (key: string, a: RenderAction) => {
    setBusy(key);
    setActionError(null);
    const res = await onAction(a);
    if (!res.ok) setActionError(res.error ?? "request failed");
    setBusy(null);
  };

  const open = renders.filter((r) => !renderIsFinished(r.status));
  const recent = renders.filter((r) => renderIsFinished(r.status));
  const positions = queuePositions(open, t);

  // Queue headers: the API's (every video encoder first), plus any group a row needs.
  const queues: RenderQueueRow[] = batchId ? [] : [...(data?.queues ?? [])];
  for (const r of open) {
    const k = groupKey(r);
    if (!queues.some((q) => q.encoderId === k)) queues.push({ encoderId: k, paused: false });
  }
  const order = (r: RenderRow) => (renderIsActive(r.status) ? 0 : (positions.get(r.id) ?? Number.MAX_SAFE_INTEGER));

  return (
    <Paper sx={{ p: 1.75 }} id="renders">
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        Renders
      </Typography>
      {batchId && (
        <Alert severity="info" sx={{ mt: 0.5 }} onClose={onClearBatch} data-testid="batch-filter">
          Showing one scheduled batch: {renders.length} video{renders.length === 1 ? "" : "s"}.
        </Alert>
      )}
      {error && <Alert severity="error">Couldn&apos;t load renders: {error}</Alert>}
      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mt: 1 }}>
          {actionError}
        </Alert>
      )}
      {data && !batchId && !queues.length && !recent.length && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Nothing rendered yet. Assign an OBS encoder to videos on /admin/streams, then Render a script.
        </Typography>
      )}

      <Stack spacing={1.75} sx={{ mt: 1 }}>
        {queues.map((q) => {
          const rows = open
            .filter((r) => groupKey(r) === q.encoderId)
            .sort((a, b) => order(a) - order(b) || a.queuedAt - b.queuedAt);
          const isPool = q.encoderId === ANY_ENCODER;
          return (
            <Box key={q.encoderId} role="group" aria-label={`Queue ${q.name || q.encoderId}`}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.75 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {isPool ? "Any video encoder" : q.name || q.encoderId}
                </Typography>
                {q.use === "channels" && <Chip size="small" variant="outlined" label="channel encoder" />}
                {q.paused && <Chip size="small" color="warning" label="paused" />}
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {isPool ? "taken by the first idle video encoder" : rows.length ? `${rows.length} in queue` : "idle"}
                </Typography>
                {!isPool && (
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy === `q:${q.encoderId}`}
                    onClick={() =>
                      act(`q:${q.encoderId}`, { action: q.paused ? "resume" : "pause", encoderId: q.encoderId })
                    }
                  >
                    {q.paused ? "Resume" : "Pause"}
                  </Button>
                )}
              </Stack>
              <Stack spacing={1}>
                {rows.map((r) => (
                  <RenderRowView
                    key={r.id}
                    r={r}
                    now={t}
                    position={positions.get(r.id)}
                    run={r.runId ? runs[r.runId] : undefined}
                    health={r.runId ? health[r.runId] : undefined}
                    youtubeStats={r.runId ? youtubeStats[r.runId] : undefined}
                    statsError={statsError}
                    busy={busy}
                    act={act}
                  />
                ))}
              </Stack>
            </Box>
          );
        })}

        {recent.length > 0 && (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
              Recent
            </Typography>
            <Stack spacing={1}>
              {recent.map((r) => (
                <RenderRowView
                  key={r.id}
                  r={r}
                  now={t}
                  run={r.runId ? runs[r.runId] : undefined}
                  busy={busy}
                  act={act}
                />
              ))}
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

function RenderRowView({
  r,
  now,
  position,
  run: socketRun,
  health,
  youtubeStats,
  statsError,
  busy,
  act,
}: {
  r: RenderRow;
  now: number;
  position?: number;
  run?: RunState;
  health?: StreamHealth;
  youtubeStats?: YoutubeVideoStats;
  statsError?: string | null;
  busy: string | null;
  act: (key: string, a: RenderAction) => void;
}) {
  const run = socketRun ?? r.run ?? null;
  const status = renderStatus(r, now, position, run);
  const active = renderIsActive(r.status);
  const watch = r.videoUrl ?? (active ? run?.youtube?.watchUrl : undefined);
  const encoder = r.assignedEncoderId ?? (r.encoderId === ANY_ENCODER ? "any video encoder" : r.encoderId);
  const meta = [
    `encoder ${encoder}`,
    r.offline ? "offline test" : `publishes ${r.publishAs}`,
    r.scheduleId ? "scheduled" : null,
    r.retryOf ? "retry" : null,
    renderIsFinished(r.status) ? fmtWhen(r.endedAt ?? r.queuedAt) : `queued ${fmtWhen(r.queuedAt)}`,
  ].filter(Boolean);

  return (
    <Paper variant="outlined" sx={{ p: 1.25 }} data-testid={`render-${r.id}`}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Chip size="small" color={status.color} label={status.label} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {run?.title || r.label || r.id}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {status.detail && (
              <Box
                component="span"
                sx={{
                  color:
                    r.status === "failed" ? "error.main" : r.status === "skipped" ? "warning.main" : "text.primary",
                }}
              >
                {status.detail} ·{" "}
              </Box>
            )}
            {meta.join(" · ")}
          </Typography>
        </Box>
        {watch && (
          <MuiLink href={watch} target="_blank" variant="body2" sx={{ whiteSpace: "nowrap" }}>
            Watch ↗
          </MuiLink>
        )}
        {r.runId && (
          <MuiLink
            component={Link}
            href={`/admin/streams/${encodeURIComponent(r.runId)}`}
            variant="body2"
            sx={{ whiteSpace: "nowrap" }}
          >
            As-run
          </MuiLink>
        )}
        {r.status === "queued" && (
          <Button size="small" disabled={busy === r.id} onClick={() => act(r.id, { action: "cancel", renderId: r.id })}>
            Cancel
          </Button>
        )}
        {active && (
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={busy === r.id}
            onClick={() => act(r.id, { action: "stop", renderId: r.id })}
          >
            Stop
          </Button>
        )}
        {renderCanRetry(r.status) && (
          <Button size="small" disabled={busy === r.id} onClick={() => act(r.id, { action: "retry", renderId: r.id })}>
            Retry
          </Button>
        )}
      </Stack>
      {active && run && <RunStats run={run} health={health} youtubeStats={youtubeStats} statsError={statsError} />}
    </Paper>
  );
}

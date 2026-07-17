"use client";

/**
 * /admin/queue — a BullMQ dashboard for the single worker queue. Browse jobs by
 * state, inspect payload / failure / return value, retry·remove·promote them,
 * pause/resume the queue, and see the repeatable schedules the worker registers.
 * All queue access is server-side via /api/admin/queue (getQueue → Redis).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import QueueJob, { type SerializedJob, type JobAction } from "../../../components/admin/QueueJob";
import QueueEventLog from "../../../components/admin/QueueEventLog";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import ClearQueueMenu from "../../../components/admin/ClearQueueMenu";
import QueueBacklog, { type BacklogRow } from "../../../components/admin/QueueBacklog";
import { accent, font, ink, status } from "../../../theme/tokens";

const STATES = ["active", "waiting", "prioritized", "delayed", "failed", "completed", "paused"] as const;
type State = (typeof STATES)[number];

interface Repeatable {
  key: string;
  id: string | null;
  label: string;
  pattern: string | null;
  every: string | number | null;
  next: number | null;
  tz: string | null;
}

interface TierSummary {
  tier: string;
  name: string;
  counts: Record<string, number>;
}

interface QueueData {
  queues: { tier: string; name: string }[];
  /** Per-tier job counts — the fg/mid/bg split, background being the memory cap. */
  byTier: TierSummary[];
  state: State;
  counts: Record<string, number> | null;
  paused: boolean;
  jobs: SerializedJob[];
  repeatables: Repeatable[];
  /** Queued work grouped by kind — only present when asked for (backlog=1). */
  backlog: BacklogRow[];
  limit: number;
  error?: string;
}

const STATE_COLOR: Record<State, string> = {
  active: accent.main,
  waiting: status.warning,
  prioritized: status.warning,
  delayed: ink.secondary,
  failed: status.error,
  completed: status.success,
  paused: ink.disabled,
};

function fmtEvery(r: Repeatable): string {
  if (r.pattern) return `cron ${r.pattern}`;
  const ms = Number(r.every);
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 60_000) return `every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `every ${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `every ${Math.round(ms / 3_600_000)}h`;
  return `every ${Math.round(ms / 86_400_000)}d`;
}

function fmtNext(next: number | null, now: number): string {
  if (!next) return "—";
  const s = Math.round((next - now) / 1000);
  if (s <= 0) return "due";
  if (s < 60) return `in ${s}s`;
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  return `in ${Math.round(s / 3600)}h`;
}

/** A tool that's currently "on" reads through the accent edge, not a fill. */
const onSx = (on: boolean) => ({
  borderColor: on ? "primary.main" : undefined,
  color: on ? "primary.main" : "text.primary",
});

export default function QueuePage() {
  const [state, setState] = useState<State>("active");
  const [limit, setLimit] = useState(100);
  const [data, setData] = useState<QueueData | null>(null);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.parse("2026-01-01T00:00:00Z"));
  // Keep the latest state/limit for the polling loop without re-arming it.
  const [showBacklog, setShowBacklog] = useState(false);
  const params = useRef({ state, limit, backlog: showBacklog });
  params.current = { state, limit, backlog: showBacklog };

  const refresh = useCallback(async () => {
    const { state: s, limit: l } = params.current;
    // backlog=1 reads every queued job's data, so only ask when the panel is open.
    const res = await fetch(
      `/api/admin/queue?state=${s}&limit=${l}${params.current.backlog ? "&backlog=1" : ""}`,
      { cache: "no-store" },
    );
    const body = (await res.json().catch(() => null)) as QueueData | null;
    if (body) setData(body);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    if (!live) return;
    const iv = setInterval(refresh, 4000);
    return () => clearInterval(iv);
  }, [refresh, live, state, limit, showBacklog]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      await fetch("/api/admin/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const jobAction = (action: JobAction, id: string) => post({ action, id });

  const counts = data?.counts ?? null;
  const total = counts?.[state] ?? 0;
  const jobs = data?.jobs ?? [];

  return (
    <AdminPageShell
      title="Queue"
      description={
        <>
          {/* The three lanes and their load — active/(waiting+prioritized+delayed).
              background is the capped lane that bounds worker memory. */}
          {data?.byTier?.length ? (
            <Stack component="span" direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              {data.byTier.map((t) => {
                const active = t.counts.active ?? 0;
                const pending = (t.counts.waiting ?? 0) + (t.counts.prioritized ?? 0) + (t.counts.delayed ?? 0);
                return (
                  <Chip
                    key={t.tier}
                    size="small"
                    variant="outlined"
                    label={`${t.tier} ${active}▸${pending}`}
                    title={`${t.name}: ${active} active, ${pending} pending`}
                  />
                );
              })}
            </Stack>
          ) : (
            "…"
          )}
          {data?.paused && (
            <Typography component="span" variant="body1" color="warning.main" sx={{ ml: 1 }}>
              paused
            </Typography>
          )}
        </>
      }
      maxWidth={860}
      actions={
        <>
          <Button variant="outlined" disabled={busy} onClick={() => post({ action: data?.paused ? "resume" : "pause" })}>
            {data?.paused ? "Resume queue" : "Pause queue"}
          </Button>
          <Button
            variant="outlined"
            onClick={() => setShowBacklog((v) => !v)}
            sx={onSx(showBacklog)}
            title="What the queued work is actually made of, by job kind"
          >
            Backlog by kind
          </Button>
          <ClearQueueMenu counts={counts} disabled={busy} onDone={refresh} />
          <Button variant="outlined" onClick={() => setLive((v) => !v)} sx={onSx(live)} title="Auto-refresh every 4s">
            {live ? "● live" : "paused"}
          </Button>
        </>
      }
    >

        {data?.error && (
          <Alert severity="error" sx={{ mt: 1.75 }}>
            Queue unreachable (worker / Redis down?) — {data.error}
          </Alert>
        )}

        {/* What the queued work is MADE of — the view that makes a backlog
            actionable, since the job list below is newest-first and truncated. */}
        {showBacklog && (
          <Paper sx={{ mt: 1.75, p: 1.5 }}>
            <QueueBacklog
              rows={data?.backlog ?? []}
              now={now}
              busy={busy}
              onCancel={(type, event) => post({ action: "cancelType", type, event: event || undefined })}
            />
          </Paper>
        )}

        {/* Live event console — worker QueueEvents streamed over the socket. */}
        <QueueEventLog />

        {/* State tabs — filters, so they speak the same chip language as /admin/jobs. */}
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 2.25 }}>
          {STATES.map((s) => {
            const on = s === state;
            const c = counts?.[s] ?? 0;
            return (
              <Chip
                key={s}
                onClick={() => {
                  setState(s);
                  setLimit(100);
                }}
                variant={on ? "filled" : "outlined"}
                color={on ? "primary" : "default"}
                label={
                  <Stack direction="row" spacing={0.875} sx={{ alignItems: "center" }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: STATE_COLOR[s], flexShrink: 0 }} />
                    <Box component="span">{s}</Box>
                    <Box component="span" sx={{ fontFamily: font.mono, fontVariantNumeric: "tabular-nums" }}>
                      {c}
                    </Box>
                  </Stack>
                }
              />
            );
          })}
        </Stack>

        {/* Per-state bulk actions */}
        <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 1.75, minHeight: 30, alignItems: "center", flexWrap: "wrap" }}>
          {state === "failed" && total > 0 && (
            <>
              <Button variant="outlined" disabled={busy} onClick={() => post({ action: "retryAll" })}>
                Retry all ({total})
              </Button>
              <Button
                variant="outlined"
                color="error"
                disabled={busy}
                onClick={() => confirm(`Delete all ${total} failed jobs?`) && post({ action: "clean", type: "failed" })}
              >
                Clean failed
              </Button>
            </>
          )}
          {state === "completed" && total > 0 && (
            <Button
              variant="outlined"
              color="error"
              disabled={busy}
              onClick={() => confirm(`Delete all ${total} completed jobs?`) && post({ action: "clean", type: "completed" })}
            >
              Clean completed
            </Button>
          )}
          <Typography variant="caption" color="text.disabled" sx={{ ml: "auto", fontVariantNumeric: "tabular-nums" }}>
            showing {jobs.length} of {total}
          </Typography>
        </Stack>

        {/* Jobs */}
        <Box sx={{ display: "grid", gap: 1, mt: 0.5 }}>
          {jobs.map((j) => (
            <QueueJob key={j.id} job={j} state={state} now={now} busy={busy} onAction={jobAction} />
          ))}
          {jobs.length === 0 && (
            <Box
              sx={{ p: 3, textAlign: "center", color: "text.disabled", border: "1px dashed", borderColor: "divider", borderRadius: 1 }}
            >
              No {state} jobs.
            </Box>
          )}
        </Box>

        {jobs.length < total && (
          <Button variant="outlined" fullWidth onClick={() => setLimit((l) => l + 200)} sx={{ mt: 1.25, py: 1.25 }}>
            Load more ({total - jobs.length} more)
          </Button>
        )}

        {/* Repeatable schedules */}
        <Typography variant="overline" component="h3" color="text.secondary" sx={{ display: "block", mt: 4, mb: 1.25 }}>
          Repeatable schedules {data?.repeatables?.length ? `(${data.repeatables.length})` : ""}
        </Typography>
        <Paper sx={{ overflow: "hidden" }}>
          {(data?.repeatables ?? []).map((r) => (
            <Stack
              key={r.key}
              direction="row"
              spacing={1.5}
              sx={{
                alignItems: "center",
                px: 1.75,
                py: 1.125,
                borderTop: "1px solid",
                borderColor: "divider",
                "&:first-of-type": { borderTop: "none" },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                  {r.label}
                </Typography>
                {r.id && r.id !== r.label && (
                  <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 1, fontFamily: font.mono }}>
                    {r.id}
                  </Typography>
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {fmtEvery(r)}
              </Typography>
              <Typography
                variant="body2"
                color="text.disabled"
                sx={{ whiteSpace: "nowrap", width: 60, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
              >
                {fmtNext(r.next, now)}
              </Typography>
            </Stack>
          ))}
          {(data?.repeatables?.length ?? 0) === 0 && (
            <Typography variant="body2" color="text.disabled" sx={{ p: 1.75 }}>
              No repeatable schedules registered.
            </Typography>
          )}
        </Paper>
    </AdminPageShell>
  );
}

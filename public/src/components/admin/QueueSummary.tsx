"use client";

/**
 * A compact, read-only "what's in-flight right now" panel for /admin/jobs — the
 * active job plus everything queued behind it, live-polled from
 * /api/admin/queue. The full dashboard (inspect / retry / remove) lives at
 * /admin/queue; this is just the at-a-glance summary above Recent activity.
 */
import { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { accent, font, ink, status } from "../../theme/tokens";

// The states we treat as "in-flight": the running job + everything queued
// (plain waiting, priority-queued, and delayed). One combined request.
const STATES = ["active", "waiting", "prioritized", "delayed"] as const;
type State = (typeof STATES)[number];

const STATE_COLOR: Record<State, string> = {
  active: accent.main,
  waiting: status.warning,
  prioritized: status.warning,
  delayed: ink.secondary,
};

interface SummaryJob {
  id: string;
  name: string;
  type: string | null;
  event: string | null;
  timestamp: number | null;
  processedOn: number | null;
  delay: number;
  progress: number;
  priority: number | null;
  state: State;
}

/** The timestamp phrase that best characterises a job in its state. */
function stamp(job: SummaryJob, now: number): string {
  const secs = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
  };
  if (job.state === "active") {
    return job.processedOn ? `running ${secs(now - job.processedOn)}` : "running";
  }
  if (job.state === "delayed") {
    const due = (job.timestamp ?? now) + (job.delay ?? 0);
    return due > now ? `in ${secs(due - now)}` : "due";
  }
  return job.timestamp ? `queued ${secs(now - job.timestamp)} ago` : "queued";
}

export default function QueueSummary({ pollMs = 4000 }: { pollMs?: number }) {
  const [jobs, setJobs] = useState<SummaryJob[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState(false);
  const [now, setNow] = useState(() => Date.parse("2026-01-01T00:00:00Z"));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/queue?state=${STATES.join(",")}&limit=50`,
        { cache: "no-store" },
      );
      const body = await res.json().catch(() => null);
      if (body) {
        setJobs(Array.isArray(body.jobs) ? body.jobs : []);
        setCounts(body.counts ?? null);
        setErr(!!body.error);
      }
    } catch {
      setErr(true);
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, pollMs);
    return () => clearInterval(iv);
  }, [refresh, pollMs]);

  const activeN = counts?.active ?? 0;
  const queuedN = (counts?.waiting ?? 0) + (counts?.prioritized ?? 0) + (counts?.delayed ?? 0);

  return (
    <Box>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "baseline", flexWrap: "wrap" }}>
        <Typography variant="h3" component="h3">
          Active &amp; queued
        </Typography>
        {err ? (
          <Typography variant="caption" color="error.main">
            queue unreachable
          </Typography>
        ) : (
          <Typography variant="caption" color="text.disabled" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {activeN} active · {queuedN} queued
          </Typography>
        )}
        <Link href="/admin/queue" variant="caption" sx={{ ml: "auto" }}>
          full queue →
        </Link>
      </Stack>

      <Paper sx={{ mt: 1.25, overflow: "hidden" }}>
        {jobs.map((j) => {
          const label = j.type && j.event ? `${j.type}.${j.event}` : j.name || "job";
          const color = STATE_COLOR[j.state] ?? ink.secondary;
          return (
            <Stack
              key={`${j.state}:${j.id}`}
              direction="row"
              spacing={1.25}
              sx={{
                alignItems: "center",
                px: 1.5,
                py: 1,
                borderTop: "1px solid",
                borderColor: "divider",
                "&:first-of-type": { borderTop: "none" },
              }}
            >
              <Box
                title={j.state}
                sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flexShrink: 0 }}
              />
              <Typography variant="body2" sx={{ minWidth: 0, fontWeight: 600, wordBreak: "break-word" }}>
                {label}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ fontFamily: font.mono }}>
                #{j.id}
              </Typography>
              {j.state === "active" && j.progress > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {Math.min(100, Math.round(j.progress))}%
                </Typography>
              )}
              <Typography
                variant="caption"
                sx={{ ml: "auto", color, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
              >
                {stamp(j, now)}
              </Typography>
            </Stack>
          );
        })}
        {jobs.length === 0 && (
          <Typography variant="body2" color="text.disabled" sx={{ p: 1.75 }}>
            {err ? "Worker / Redis unreachable." : "Nothing running or queued."}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

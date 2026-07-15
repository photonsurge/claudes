"use client";

/**
 * /admin/jobs — operator triggers for worker jobs. The public app never calls
 * upstream feeds itself; it just enqueues a BullMQ job and the worker does the
 * work (fetch → Mongo). This page is the manual "run now" surface alongside the
 * worker's own schedules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { TriggerableJob } from "@photonsurge/shared/jobs";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import LogTail from "../../../components/admin/LogTail";
import QueueSummary from "../../../components/admin/QueueSummary";
import ClearQueueMenu from "../../../components/admin/ClearQueueMenu";
import type { Result, StopResult } from "../../../components/admin/jobs/JobCard";
import JobGroupPanel from "../../../components/admin/jobs/JobGroupPanel";
import JobsToolbar from "../../../components/admin/jobs/JobsToolbar";

/** Group jobs by their `group`, preserving first-seen (catalog) order. */
function groupJobs(jobs: TriggerableJob[]): Array<[string, TriggerableJob[]]> {
  const order: string[] = [];
  const byGroup = new Map<string, TriggerableJob[]>();
  for (const j of jobs) {
    const g = j.group ?? "Other";
    if (!byGroup.has(g)) {
      byGroup.set(g, []);
      order.push(g);
    }
    byGroup.get(g)!.push(j);
  }
  return order.map((g) => [g, byGroup.get(g)!]);
}

/** Free-text match over the fields an operator would search by. */
function matches(j: TriggerableJob, q: string): boolean {
  const hay = `${j.label} ${j.description} ${j.group} ${j.id}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<TriggerableJob[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [stopResults, setStopResults] = useState<Record<string, StopResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  // Latest enqueued jobId per row, so an in-flight poll knows if it's been superseded.
  const latestJob = useRef<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/jobs", { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (body) {
      setJobs(body.jobs ?? []);
      setCounts(body.counts ?? null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);

  /**
   * Poll the enqueued job until it finishes, surfacing its live state + run
   * duration on the row. Bails if the row was re-run (jobId changed) or after a
   * generous cap (weather bakes can take minutes).
   */
  const pollStatus = useCallback(async (id: string, jobId: string) => {
    const started = Date.now();
    const MAX_MS = 5 * 60 * 1000;
    while (Date.now() - started < MAX_MS) {
      await new Promise((r) => setTimeout(r, 1200));
      let st: { state?: string; durationMs?: number | null; failedReason?: string | null } | null = null;
      try {
        const res = await fetch(`/api/admin/jobs?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
        st = await res.json().catch(() => null);
      } catch {
        continue; // transient — keep polling
      }
      if (!st) continue;
      if (latestJob.current[id] !== jobId) return; // a newer run superseded this one
      setResults((r) =>
        r[id]?.jobId === jobId
          ? { ...r, [id]: { ...r[id], state: st!.state, durationMs: st!.durationMs, failedReason: st!.failedReason } }
          : r,
      );
      if (st.state === "completed" || st.state === "failed" || st.state === "unknown") return;
    }
  }, []);

  const run = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await res.json().catch(() => ({}));
      setResults((r) => ({
        ...r,
        [id]: { ok: !!body.ok, jobId: body.jobId, error: body.error, at: new Date().toISOString() },
      }));
      refresh();
      if (body.ok && body.jobId) {
        latestJob.current[id] = String(body.jobId);
        void pollStatus(id, String(body.jobId));
      }
    } finally {
      setBusy(null);
    }
  };

  const stop = async (j: TriggerableJob) => {
    setStopping(j.id);
    try {
      const res = await fetch("/api/admin/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stopChain", type: j.type, event: j.event }),
      });
      const body = await res.json().catch(() => ({}));
      setStopResults((r) => ({
        ...r,
        [j.id]: { ok: !!body.ok, removed: body.detail?.removed, error: body.error, at: new Date().toISOString() },
      }));
      refresh();
    } finally {
      setStopping(null);
    }
  };

  // Chips always show the whole catalog's shape; only the grid narrows.
  const allGroups = useMemo<Array<[string, number]>>(
    () => groupJobs(jobs).map(([g, list]) => [g, list.length]),
    [jobs],
  );
  const visible = useMemo(
    () => jobs.filter((j) => (group === null || j.group === group) && (!query.trim() || matches(j, query))),
    [jobs, group, query],
  );

  return (
    <AdminPageShell
      title="Worker jobs"
      description="Manual triggers for worker ingest, snapshot and enrichment jobs."
      maxWidth="none"
      actions={
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          {counts ? (
            <Typography variant="caption" color="text.secondary">
              queue · active {counts.active ?? 0} · waiting {counts.waiting ?? 0} · done{" "}
              {counts.completed ?? 0} · failed {counts.failed ?? 0}
            </Typography>
          ) : (
            <Typography variant="caption" color="error.main">
              queue unreachable (worker/Redis down?)
            </Typography>
          )}
          <ClearQueueMenu counts={counts} onDone={refresh} />
        </Stack>
      }
    >
      <JobsToolbar
        query={query}
        onQuery={setQuery}
        groups={allGroups}
        active={group}
        onGroup={setGroup}
        total={jobs.length}
        shown={visible.length}
      />

      {visible.length === 0 && jobs.length > 0 && (
        <Typography variant="body2" color="text.disabled" sx={{ py: 3.5 }}>
          No jobs match that search.
        </Typography>
      )}

      {/*
        `align-items: start` so a one-job panel keeps its own height instead of
        stretching to the tallest panel in its row, and `dense` so those small
        panels backfill the gaps the wide ones leave.

        Spans step down with the viewport: a panel spanning more columns than the
        grid has would add implicit columns and push the page sideways.
      */}
      <Box
        sx={{
          display: "grid",
          gap: 1.75,
          gridAutoFlow: "dense",
          alignItems: "start",
          gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
          "& .job-span-2": { gridColumn: "span 2" },
          "& .job-span-3": { gridColumn: "span 3" },
          "& .job-span-4": { gridColumn: "span 4" },
          "@media (max-width:1500px)": { "& .job-span-4": { gridColumn: "span 3" } },
          "@media (max-width:1180px)": { "& .job-span-3, & .job-span-4": { gridColumn: "span 2" } },
          "@media (max-width:860px)": { "& .job-panel": { gridColumn: "span 1" } },
        }}
      >
        {groupJobs(visible).map(([groupName, groupJobsList]) => (
          <JobGroupPanel
            key={groupName}
            group={groupName}
            jobs={groupJobsList}
            results={results}
            stopResults={stopResults}
            busy={busy}
            stopping={stopping}
            onRun={run}
            onStop={stop}
          />
        ))}
      </Box>

      <Box sx={{ mt: 3.5 }}>
        <QueueSummary />
      </Box>

      <Box sx={{ mt: 3.5 }}>
        <LogTail limit={100} title="Recent activity" excludeType="request" />
      </Box>
    </AdminPageShell>
  );
}

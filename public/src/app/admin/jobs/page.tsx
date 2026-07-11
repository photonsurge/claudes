"use client";

/**
 * /admin/jobs — operator triggers for worker jobs. The public app never calls
 * upstream feeds itself; it just enqueues a BullMQ job and the worker does the
 * work (fetch → Mongo). This page is the manual "run now" surface alongside the
 * worker's own schedules.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { TriggerableJob } from "@photonsurge/shared/jobs";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import LogTail from "../../../components/admin/LogTail";

interface Result {
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

/** ms → "840ms" / "3.2s" / "1m4s". */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

/** The one-line status + colour for a triggered job's result row. */
function resultLine(r: Result): { text: string; color: string } {
  if (!r.ok) return { text: `failed: ${r.error}`, color: "#fca5a5" };
  const d = typeof r.durationMs === "number" ? fmtDuration(r.durationMs) : null;
  switch (r.state) {
    case "completed":
      return { text: d ? `done in ${d}` : "done", color: "#4ade80" };
    case "failed":
      return { text: `failed after ${d ?? "?"}${r.failedReason ? `: ${r.failedReason}` : ""}`, color: "#fca5a5" };
    case "active":
      return { text: d ? `running… ${d}` : "running…", color: "#fbbf24" };
    case "unknown":
      // Reaped after completion (admin jobs kept 1h) or never landed — best-effort.
      return { text: `queued (#${r.jobId})`, color: "#8b95a7" };
    default:
      return { text: `queued (#${r.jobId})`, color: "#8b95a7" };
  }
}

interface StopResult {
  ok: boolean;
  removed?: number;
  error?: string;
  at: string;
}

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

export default function JobsPage() {
  const [jobs, setJobs] = useState<TriggerableJob[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [stopResults, setStopResults] = useState<Record<string, StopResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
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

  return (
    <AdminPageShell
      title="Worker jobs"
      description="Manual triggers for worker ingest, snapshot and enrichment jobs."
      maxWidth={760}
      actions={
        counts ? (
          <div style={{ color: "#8b95a7", fontSize: 12 }}>
            queue · active {counts.active ?? 0} · waiting {counts.waiting ?? 0} · done{" "}
            {counts.completed ?? 0} · failed {counts.failed ?? 0}
          </div>
        ) : (
          <div style={{ color: "#fca5a5", fontSize: 12 }}>queue unreachable (worker/Redis down?)</div>
        )
      }
    >

        {groupJobs(jobs).map(([group, groupJobsList]) => (
          <section key={group} style={{ marginTop: 22 }}>
            <h3
              style={{
                margin: "0 0 10px",
                fontSize: 12,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: "#8b95a7",
              }}
            >
              {group}
            </h3>
            <div style={{ display: "grid", gap: 12 }}>
              {groupJobsList.map((j) => {
                const r = results[j.id];
                const sr = stopResults[j.id];
                return (
                  <div
                    key={j.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: 14,
                      borderRadius: 8,
                      border: "1px solid #1b2030",
                      background: "#0c111c",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{j.label}</div>
                      <div style={{ color: "#8b95a7", fontSize: 13 }}>{j.description}</div>
                      {r && (() => {
                        const line = resultLine(r);
                        return (
                          <div style={{ fontSize: 12, marginTop: 4, color: line.color }}>
                            {line.text} · {new Date(r.at).toLocaleTimeString()}
                          </div>
                        );
                      })()}
                      {sr && (
                        <div style={{ fontSize: 12, marginTop: 4, color: sr.ok ? "#4ade80" : "#fca5a5" }}>
                          {sr.ok ? `stopped — ${sr.removed ?? 0} queued batch(es) removed` : `failed: ${sr.error}`} ·{" "}
                          {new Date(sr.at).toLocaleTimeString()}
                        </div>
                      )}
                    </div>
                    {j.stoppable && (
                      <button
                        type="button"
                        onClick={() => stop(j)}
                        disabled={stopping === j.id}
                        style={{
                          padding: "8px 16px",
                          borderRadius: 6,
                          border: "1px solid #333",
                          background: stopping === j.id ? "#1a1f2b" : "#7f1d1d",
                          color: "#fff",
                          cursor: "pointer",
                        }}
                      >
                        {stopping === j.id ? "…" : "Stop"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => run(j.id)}
                      disabled={busy === j.id}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 6,
                        border: "1px solid #333",
                        background: busy === j.id ? "#1a1f2b" : "#2563eb",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {busy === j.id ? "…" : "Run now"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <div style={{ marginTop: 28 }}>
          <LogTail limit={100} title="Recent activity" />
        </div>
    </AdminPageShell>
  );
}

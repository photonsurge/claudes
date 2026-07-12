"use client";

/**
 * A compact, read-only "what's in-flight right now" panel for /admin/jobs — the
 * active job plus everything queued behind it, live-polled from
 * /api/admin/queue. The full dashboard (inspect / retry / remove) lives at
 * /admin/queue; this is just the at-a-glance summary above Recent activity.
 */
import { useCallback, useEffect, useState } from "react";

// The states we treat as "in-flight": the running job + everything queued
// (plain waiting, priority-queued, and delayed). One combined request.
const STATES = ["active", "waiting", "prioritized", "delayed"] as const;
type State = (typeof STATES)[number];
const QUEUED = new Set<State>(["waiting", "prioritized", "delayed"]);

const STATE_COLOR: Record<State, string> = {
  active: "#60a5fa",
  waiting: "#fbbf24",
  prioritized: "#fbbf24",
  delayed: "#a78bfa",
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
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Active &amp; queued</h3>
        {err ? (
          <span style={{ color: "#fca5a5", fontSize: 12 }}>queue unreachable</span>
        ) : (
          <span style={{ color: "#5b6577", fontSize: 12 }}>
            {activeN} active · {queuedN} queued
          </span>
        )}
        <a
          href="/admin/queue"
          style={{ marginLeft: "auto", fontSize: 12, color: "#60a5fa", textDecoration: "none" }}
        >
          full queue →
        </a>
      </div>

      <div
        style={{
          marginTop: 10,
          border: "1px solid #1b2030",
          borderRadius: 8,
          background: "#0a0e16",
          overflow: "hidden",
        }}
      >
        {jobs.map((j) => {
          const label = j.type && j.event ? `${j.type}.${j.event}` : j.name || "job";
          const color = STATE_COLOR[j.state] ?? "#8b95a7";
          return (
            <div
              key={`${j.state}:${j.id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderTop: "1px solid #121826",
                fontSize: 13,
              }}
            >
              <span
                style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }}
                title={j.state}
              />
              <span style={{ fontWeight: 600, minWidth: 0, wordBreak: "break-word" }}>{label}</span>
              <span style={{ fontSize: 11, color: "#5b6577", fontFamily: "ui-monospace, monospace" }}>
                #{j.id}
              </span>
              {j.state === "active" && j.progress > 0 && (
                <span style={{ fontSize: 11, color: "#8b95a7" }}>{Math.min(100, Math.round(j.progress))}%</span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 12, color, whiteSpace: "nowrap" }}>
                {stamp(j, now)}
              </span>
            </div>
          );
        })}
        {jobs.length === 0 && (
          <div style={{ padding: 14, color: "#5b6577", fontSize: 13 }}>
            {err ? "Worker / Redis unreachable." : "Nothing running or queued."}
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

/**
 * One triggerable job on /admin/jobs. Cards sit in a responsive grid; the
 * description is shown in full (several of these carry real operating caveats —
 * "run the dry run first", "run the migration first" — so they must not be
 * truncated), and the actions are pinned to the card's foot so a row's buttons
 * line up.
 */
import type { TriggerableJob } from "@photonsurge/shared/jobs";

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

/** ms → "840ms" / "3.2s" / "1m4s". */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

/** The one-line status + colour for a triggered job's result row. */
export function resultLine(r: Result): { text: string; color: string } {
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

const btn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  color: "#fff",
  cursor: "pointer",
  fontSize: 13,
};

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 14,
        borderRadius: 8,
        // A card must read against the panel it sits in, not blend into it.
        border: `1px solid ${active ? "#4c6098" : "#333e54"}`,
        background: "#0e1420",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3, color: "#f1f5fb" }}>{job.label}</div>

      <div style={{ color: "#98a3b6", fontSize: 13.5, lineHeight: 1.5 }}>{job.description}</div>

      {/* Push the actions to the card's foot so a grid row's buttons line up. */}
      <div style={{ flex: 1, minHeight: 4 }} />

      {result && (() => {
        const line = resultLine(result);
        return (
          <div style={{ fontSize: 12, color: line.color }}>
            {line.text} · {new Date(result.at).toLocaleTimeString()}
          </div>
        );
      })()}
      {stopResult && (
        <div style={{ fontSize: 12, color: stopResult.ok ? "#4ade80" : "#fca5a5" }}>
          {stopResult.ok ? `stopped — ${stopResult.removed ?? 0} queued batch(es) removed` : `failed: ${stopResult.error}`} ·{" "}
          {new Date(stopResult.at).toLocaleTimeString()}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          style={{ ...btn, flex: 1, background: running ? "#1a1f2b" : "#2563eb" }}
        >
          {running ? "…" : "Run now"}
        </button>
        {job.stoppable && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            style={{ ...btn, background: stopping ? "#1a1f2b" : "#7f1d1d" }}
          >
            {stopping ? "…" : "Stop"}
          </button>
        )}
      </div>
    </div>
  );
}

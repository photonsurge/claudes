"use client";

/**
 * One triggerable job on /admin/jobs. Cards sit in a responsive grid, so the
 * long descriptions clamp to a few lines and expand on click rather than
 * setting the row height for everything beside them.
 */
import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
  // Long blurbs are the norm here; only the wordy ones need a toggle.
  const clampable = job.description.length > 150;
  const active = result?.state === "active";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 14,
        borderRadius: 8,
        border: `1px solid ${active ? "#3b4a6b" : "#1b2030"}`,
        background: "#0c111c",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{job.label}</div>

      <div
        onClick={clampable ? () => setExpanded((e) => !e) : undefined}
        style={{
          color: "#8b95a7",
          fontSize: 12.5,
          lineHeight: 1.45,
          cursor: clampable ? "pointer" : "default",
          ...(clampable && !expanded
            ? { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }
            : null),
        }}
        title={clampable ? (expanded ? "Click to collapse" : "Click to read all") : undefined}
      >
        {job.description}
      </div>

      {/* Push the actions to the card's foot so a grid row's buttons line up. */}
      <div style={{ flex: 1 }} />

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

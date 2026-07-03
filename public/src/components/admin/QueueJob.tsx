"use client";

import { useState } from "react";

/** One BullMQ job flattened by /api/admin/queue. */
export interface SerializedJob {
  id: string;
  name: string;
  domain: string | null;
  type: string | null;
  event: string | null;
  payload: unknown;
  attemptsMade: number;
  maxAttempts: number;
  timestamp: number | null;
  processedOn: number | null;
  finishedOn: number | null;
  delay: number;
  progress: number;
  priority: number | null;
  failedReason: string | null;
  stacktrace: string[];
  returnvalue: unknown;
  repeatJobKey: string | null;
}

export type JobAction = "retry" | "remove" | "promote";

function relTime(ms: number | null, now: number): string {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** The timestamp that best characterises a job in a given state. */
function stamp(job: SerializedJob, state: string, now: number): string {
  if (state === "completed" || state === "failed") return relTime(job.finishedOn, now);
  if (state === "active") return relTime(job.processedOn, now);
  if (state === "delayed") {
    const due = (job.timestamp ?? now) + (job.delay ?? 0);
    const inS = Math.round((due - now) / 1000);
    return inS > 0 ? `in ${inS < 60 ? `${inS}s` : inS < 3600 ? `${Math.round(inS / 60)}m` : `${Math.round(inS / 3600)}h`}` : "due";
  }
  return relTime(job.timestamp, now);
}

const btn = (bg: string): React.CSSProperties => ({
  padding: "5px 11px",
  borderRadius: 6,
  border: "1px solid #2a3344",
  background: bg,
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#5b6577", marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 10,
        borderRadius: 6,
        background: "#070a11",
        border: "1px solid #161c2a",
        color: "#94a3b8",
        fontSize: 11.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: 260,
        overflow: "auto",
      }}
    >
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function QueueJob({
  job,
  state,
  now,
  busy,
  onAction,
}: {
  job: SerializedJob;
  state: string;
  now: number;
  busy: boolean;
  onAction: (action: JobAction, id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = job.type && job.event ? `${job.type}.${job.event}` : job.name || "job";
  const hasBody = job.payload != null && Object.keys(job.payload as object).length > 0;

  return (
    <div style={{ borderRadius: 8, border: "1px solid #1b2030", background: "#0c111c" }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", cursor: "pointer" }}
      >
        <span style={{ color: "#475569", width: 14 }}>{open ? "▾" : "▸"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 11, color: "#5b6577", fontFamily: "ui-monospace, monospace" }}>#{job.id}</span>
            {job.attemptsMade > 0 && (
              <span style={{ fontSize: 11, color: job.failedReason ? "#fca5a5" : "#8b95a7" }}>
                attempt {job.attemptsMade}/{job.maxAttempts}
              </span>
            )}
            {job.priority ? <span style={{ fontSize: 11, color: "#8b95a7" }}>prio {job.priority}</span> : null}
          </div>
          {job.failedReason && (
            <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {job.failedReason}
            </div>
          )}
          {state === "active" && job.progress > 0 && (
            <div style={{ height: 3, borderRadius: 2, background: "#1b2030", marginTop: 6, overflow: "hidden" }}>
              <div style={{ width: `${Math.min(100, job.progress)}%`, height: "100%", background: "#2563eb" }} />
            </div>
          )}
        </div>
        <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>{stamp(job, state, now)}</span>
      </div>

      {open && (
        <div style={{ padding: "0 14px 14px 40px", borderTop: "1px solid #121826" }}>
          {job.repeatJobKey && (
            <Field label="repeatable">
              <span style={{ fontSize: 12, color: "#8b95a7", fontFamily: "ui-monospace, monospace" }}>{job.repeatJobKey}</span>
            </Field>
          )}
          {hasBody && (
            <Field label="data">
              <Json value={job.payload} />
            </Field>
          )}
          {job.failedReason && (
            <Field label={`failed reason (${job.stacktrace.length} stack frames)`}>
              <Json value={job.stacktrace.length ? job.stacktrace.join("\n\n") : job.failedReason} />
            </Field>
          )}
          {job.returnvalue != null && (
            <Field label="return value">
              <Json value={job.returnvalue} />
            </Field>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {state === "failed" && (
              <button type="button" disabled={busy} onClick={() => onAction("retry", job.id)} style={btn("#2563eb")}>
                Retry
              </button>
            )}
            {state === "delayed" && (
              <button type="button" disabled={busy} onClick={() => onAction("promote", job.id)} style={btn("#2563eb")}>
                Promote
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => onAction("remove", job.id)} style={btn("#3a1620")}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

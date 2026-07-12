"use client";

/**
 * Live console for the worker queue, streamed over the socket. Two feeds share
 * one scrolling view:
 *  - `queue:event` — BullMQ lifecycle (added → active → completed/failed …).
 *  - `queue:log`   — a job's own console output while it runs, so you can watch
 *                    what a long-running job is actually doing, per job.
 * The worker (queueEventBridge.ts / jobLog.ts) fans both out to the public room;
 * here we subscribe, `console.log` each to devtools, and render them inline.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSocket } from "../../lib/socket-provider";

const QUEUE_EVENT = "queue:event";
const QUEUE_LOG = "queue:log";

type Phase =
  | "added"
  | "waiting"
  | "active"
  | "progress"
  | "completed"
  | "failed"
  | "retries-exhausted"
  | "delayed"
  | "stalled"
  | "removed"
  | "drained"
  | "cleaned"
  | "paused"
  | "resumed";

interface QueueEventData {
  phase: Phase;
  jobId: string | null;
  label: string | null;
  prev?: string | null;
  delay?: number | null;
  progress?: unknown;
  failedReason?: string | null;
  name?: string | null;
  count?: number;
  attemptsMade?: number | null;
}

interface QueueLogData {
  jobId: string | null;
  label: string | null;
  level: "info" | "warn" | "error";
  line: string;
}

interface Msg<T> {
  type?: string;
  jobId?: string;
  source?: string;
  createdAt?: string;
  data?: T;
}

type FeedRow =
  | ({ kind: "event"; key: string; at: number } & QueueEventData)
  | ({ kind: "log"; key: string; at: number } & QueueLogData);

const PHASE_COLOR: Record<Phase, string> = {
  added: "#64748b",
  waiting: "#fbbf24",
  active: "#60a5fa",
  progress: "#38bdf8",
  completed: "#4ade80",
  failed: "#f87171",
  "retries-exhausted": "#ef4444",
  delayed: "#a78bfa",
  stalled: "#fb923c",
  removed: "#6b7280",
  drained: "#475569",
  cleaned: "#475569",
  paused: "#fbbf24",
  resumed: "#4ade80",
};

const LEVEL_COLOR: Record<QueueLogData["level"], string> = {
  info: "#93a4bd",
  warn: "#fbbf24",
  error: "#f87171",
};

const MAX_ROWS = 500;

function hhmmss(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Short trailing detail per lifecycle phase. */
function detailOf(r: Extract<FeedRow, { kind: "event" }>): string {
  switch (r.phase) {
    case "failed":
      return r.failedReason ? `— ${r.failedReason}` : "";
    case "delayed":
      return r.delay != null ? `+${Math.round(r.delay / 1000)}s` : "";
    case "progress":
      return typeof r.progress === "number" ? `${r.progress}%` : r.progress ? JSON.stringify(r.progress) : "";
    case "cleaned":
      return r.count != null ? `${r.count} job(s)` : "";
    case "retries-exhausted":
      return r.attemptsMade != null ? `after ${r.attemptsMade} attempts` : "";
    default:
      return "";
  }
}

export default function QueueEventLog() {
  const { socket, connected } = useSocket();
  const [rows, setRows] = useState<FeedRow[]>([]);
  const [open, setOpen] = useState(true);
  const [showLogs, setShowLogs] = useState(true);
  const [jobFilter, setJobFilter] = useState("");
  // Refs so the once-bound socket handlers always read live UI state.
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  pausedRef.current = paused;
  const seq = useRef(0);

  useEffect(() => {
    if (!socket) return;

    const push = (row: FeedRow) => {
      if (pausedRef.current) return;
      setRows((prev) => {
        const next = [row, ...prev];
        return next.length > MAX_ROWS ? next.slice(0, MAX_ROWS) : next;
      });
    };

    const onEvent = (msg: Msg<QueueEventData>) => {
      const d = msg?.data;
      if (!d?.phase) return;
      const color = PHASE_COLOR[d.phase] ?? "#8b95a7";
      // eslint-disable-next-line no-console
      console.log(
        `%c[queue] ${d.phase}%c ${d.label ?? (d.jobId ? `#${d.jobId}` : "")}`,
        `color:${color};font-weight:600`,
        "color:inherit",
        d,
      );
      push({ kind: "event", key: `${seq.current++}`, at: Date.now(), ...d });
    };

    const onLog = (msg: Msg<QueueLogData>) => {
      const d = msg?.data;
      if (!d || typeof d.line !== "string") return;
      const tag = d.label ?? (d.jobId ? `#${d.jobId}` : "job");
      // eslint-disable-next-line no-console
      console.log(`[queue:${tag}] ${d.line}`);
      push({ kind: "log", key: `${seq.current++}`, at: Date.now(), ...d });
    };

    socket.on(QUEUE_EVENT, onEvent);
    socket.on(QUEUE_LOG, onLog);
    return () => {
      socket.off(QUEUE_EVENT, onEvent);
      socket.off(QUEUE_LOG, onLog);
    };
  }, [socket]);

  const visible = useMemo(() => {
    const f = jobFilter.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showLogs && r.kind === "log") return false;
      if (!f) return true;
      return (r.label ?? "").toLowerCase().includes(f) || (r.jobId ?? "").toLowerCase().includes(f);
    });
  }, [rows, showLogs, jobFilter]);

  const toggleBtn = (on: boolean, onColor = "#14532d"): React.CSSProperties => ({
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #2a3344",
    background: on ? onColor : "#1a1f2b",
    color: on ? "#fff" : "#8b95a7",
    cursor: "pointer",
    fontSize: 12,
  });

  return (
    <div style={{ marginTop: 18, border: "1px solid #1b2030", borderRadius: 8, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "9px 14px",
          background: "#0c111c",
          borderBottom: open ? "1px solid #121826" : "none",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{ background: "none", border: "none", color: "#dfe7f5", cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 }}
        >
          {open ? "▾" : "▸"} Live events
        </button>
        <span
          title={connected ? "socket connected" : "socket disconnected"}
          style={{ width: 8, height: 8, borderRadius: "50%", background: connected ? "#4ade80" : "#f87171" }}
        />
        <span style={{ color: "#5b6577", fontSize: 12 }}>
          {connected ? "streaming" : "offline"} · {visible.length}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
            placeholder="filter job…"
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #2a3344",
              background: "#0a0e16",
              color: "#c9d4e6",
              fontSize: 12,
              width: 120,
            }}
          />
          <button type="button" onClick={() => setShowLogs((v) => !v)} style={toggleBtn(showLogs, "#1e3a5f")} title="Show job console output">
            logs
          </button>
          <button type="button" onClick={() => setPaused((v) => !v)} style={toggleBtn(!paused)}>
            {paused ? "paused" : "● live"}
          </button>
          <button type="button" onClick={() => setRows([])} style={toggleBtn(false)}>
            clear
          </button>
        </div>
      </div>

      {open && (
        <div style={{ maxHeight: 320, overflowY: "auto", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
          {visible.length === 0 && (
            <div style={{ padding: 16, color: "#5b6577" }}>
              {connected ? "Waiting for queue activity…" : "Socket offline — no live events."}
            </div>
          )}
          {visible.map((r) =>
            r.kind === "event" ? (
              <div
                key={r.key}
                style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "4px 14px", borderTop: "1px solid #10151f", whiteSpace: "nowrap" }}
              >
                <span style={{ color: "#4b5568", flexShrink: 0 }}>{hhmmss(r.at)}</span>
                <span style={{ color: PHASE_COLOR[r.phase] ?? "#8b95a7", fontWeight: 600, width: 132, flexShrink: 0 }}>{r.phase}</span>
                <span style={{ color: "#c9d4e6", flexShrink: 0 }}>{r.label ?? (r.jobId ? `#${r.jobId}` : "—")}</span>
                <span style={{ color: "#6b7688", overflow: "hidden", textOverflow: "ellipsis" }}>{detailOf(r)}</span>
              </div>
            ) : (
              <div
                key={r.key}
                style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "4px 14px", borderTop: "1px solid #10151f" }}
              >
                <span style={{ color: "#4b5568", flexShrink: 0 }}>{hhmmss(r.at)}</span>
                <span style={{ color: LEVEL_COLOR[r.level], width: 132, flexShrink: 0, opacity: 0.85 }}>
                  ⤷ {r.label ?? (r.jobId ? `#${r.jobId}` : "log")}
                </span>
                <span style={{ color: LEVEL_COLOR[r.level], whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>{r.line}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

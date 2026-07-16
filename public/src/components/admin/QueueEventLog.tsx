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
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useSocket } from "../../lib/socket-provider";
import { accent, font, ink, status, surface } from "../../theme/tokens";

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

/**
 * Resolved token values rather than theme keys ("warning.main"): these colour
 * the devtools `console.log` CSS below as well as the rendered rows, and a %c
 * format string needs a real colour.
 */
const PHASE_COLOR: Record<Phase, string> = {
  added: ink.secondary,
  waiting: status.warning,
  active: accent.main,
  progress: accent.main,
  completed: status.success,
  failed: status.error,
  "retries-exhausted": status.error,
  delayed: ink.secondary,
  stalled: status.severe,
  removed: ink.disabled,
  drained: ink.disabled,
  cleaned: ink.disabled,
  paused: status.warning,
  resumed: status.success,
};

const LEVEL_COLOR: Record<QueueLogData["level"], string> = {
  info: ink.secondary,
  warn: status.warning,
  error: status.error,
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
      const color = PHASE_COLOR[d.phase] ?? ink.secondary;
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

  /** A toggle reads "on" through the accent edge, never a filled background. */
  const toggleSx = (on: boolean) => ({
    borderColor: on ? "primary.main" : undefined,
    color: on ? "primary.main" : "text.secondary",
  });

  const rowSx = {
    alignItems: "baseline",
    px: 1.75,
    py: 0.5,
    borderTop: "1px solid",
    borderColor: "divider",
  } as const;

  return (
    <Paper sx={{ mt: 2.25, overflow: "hidden" }}>
      <Stack
        direction="row"
        spacing={1.25}
        useFlexGap
        sx={{
          alignItems: "center",
          flexWrap: "wrap",
          px: 1.75,
          py: 1.125,
          bgcolor: surface.raised,
          borderBottom: open ? "1px solid" : "none",
          borderColor: "divider",
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={() => setOpen((v) => !v)}
          sx={{
            background: "none",
            border: "none",
            p: 0,
            font: "inherit",
            fontSize: 13,
            fontWeight: 600,
            color: "text.primary",
            cursor: "pointer",
          }}
        >
          {open ? "▾" : "▸"} Live events
        </Box>
        <Box
          title={connected ? "socket connected" : "socket disconnected"}
          sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: connected ? "success.main" : "error.main" }}
        />
        <Typography variant="caption" color="text.disabled">
          {connected ? "streaming" : "offline"} · {visible.length}
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ ml: "auto", alignItems: "center", flexWrap: "wrap" }}>
          <TextField
            value={jobFilter}
            onChange={(e) => setJobFilter(e.target.value)}
            placeholder="filter job…"
            sx={{ width: 120 }}
          />
          <Button variant="outlined" onClick={() => setShowLogs((v) => !v)} sx={toggleSx(showLogs)} title="Show job console output">
            logs
          </Button>
          <Button variant="outlined" onClick={() => setPaused((v) => !v)} sx={toggleSx(!paused)}>
            {paused ? "paused" : "● live"}
          </Button>
          <Button variant="outlined" onClick={() => setRows([])} sx={toggleSx(false)}>
            clear
          </Button>
        </Stack>
      </Stack>

      {open && (
        <Box sx={{ maxHeight: 320, overflowY: "auto", fontFamily: font.mono, fontSize: 12 }}>
          {visible.length === 0 && (
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", p: 2 }}>
              {connected ? "Waiting for queue activity…" : "Socket offline — no live events."}
            </Typography>
          )}
          {visible.map((r) =>
            r.kind === "event" ? (
              <Stack key={r.key} direction="row" spacing={1.25} sx={{ ...rowSx, whiteSpace: "nowrap" }}>
                <Box component="span" sx={{ color: "text.disabled", flexShrink: 0 }}>
                  {hhmmss(r.at)}
                </Box>
                <Box component="span" sx={{ color: PHASE_COLOR[r.phase] ?? ink.secondary, fontWeight: 600, width: 132, flexShrink: 0 }}>
                  {r.phase}
                </Box>
                <Box component="span" sx={{ color: "text.primary", flexShrink: 0 }}>
                  {r.label ?? (r.jobId ? `#${r.jobId}` : "—")}
                </Box>
                <Box component="span" sx={{ color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {detailOf(r)}
                </Box>
              </Stack>
            ) : (
              <Stack key={r.key} direction="row" spacing={1.25} sx={rowSx}>
                <Box component="span" sx={{ color: "text.disabled", flexShrink: 0 }}>
                  {hhmmss(r.at)}
                </Box>
                <Box component="span" sx={{ color: LEVEL_COLOR[r.level], width: 132, flexShrink: 0, opacity: 0.85 }}>
                  ⤷ {r.label ?? (r.jobId ? `#${r.jobId}` : "log")}
                </Box>
                <Box component="span" sx={{ color: LEVEL_COLOR[r.level], whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
                  {r.line}
                </Box>
              </Stack>
            ),
          )}
        </Box>
      )}
    </Paper>
  );
}

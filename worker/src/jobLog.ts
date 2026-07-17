// jobLog.ts
// Per-job console capture. Job handlers log with `log()`/`logger.*` (which bottom
// out in `console.*`) and plain `console.log`. To let /admin/queue show *what a
// long-running job is actually doing*, we run each handler inside an
// AsyncLocalStorage context (jobId + label) and monkey-patch `console.*` so that
// any line emitted while a job is on the stack is also fanned out over the socket
// as a `queue:log` event, tagged with that job. Framework/boot logs (no job on
// the stack) are untouched — only handler output is streamed.
import { AsyncLocalStorage } from "async_hooks";
import { format } from "util";
import { emitWorkerEvent } from "./socket";

/** Fan-out event name browsers listen for (see socket relay: payload.type). */
export const QUEUE_LOG_TYPE = "queue:log";

interface JobLogCtx {
  jobId: string;
  label: string;
  // Rolling per-job rate-limit window, so a job logging in a tight loop can't
  // flood every connected browser.
  windowStart: number;
  count: number;
}

const als = new AsyncLocalStorage<JobLogCtx>();

const RATE_WINDOW_MS = 1000;
const RATE_MAX = 40; // lines per job per window before we drop + warn
const MAX_LINE = 2000;

// ---- Per-job ring buffer -----------------------------------------------------
// Streaming reaches only browsers that were connected while the job ran. To let
// /admin/queue *pull* a job's log (on expand, even after it finished), we also
// retain recent lines here, keyed by jobId. Bounded both ways so a chatty run or
// a long uptime can't grow this without limit; oldest job evicted first (Map
// keeps insertion order). Each line carries a process-global `seq` so the client
// can merge this history with the live socket stream without duplicates.
const RING_MAX_LINES = 100; // per job
const RING_MAX_JOBS = 200;

export interface JobLogEntry {
  seq: number;
  ts: number;
  level: "info" | "warn" | "error";
  line: string;
}

interface JobLogRecord {
  label: string;
  lines: JobLogEntry[];
}

/** One row of the retained-logs index — enough to pick a job to pull. */
export interface JobLogSummary {
  jobId: string;
  label: string;
  count: number;
  lastTs: number;
  lastLine: string;
}

let seqCounter = 0;
const ring = new Map<string, JobLogRecord>();

function retain(jobId: string, label: string, entry: JobLogEntry): void {
  const prev = ring.get(jobId);
  const rec = prev ?? { label, lines: [] };
  rec.label = label;
  rec.lines.push(entry);
  if (rec.lines.length > RING_MAX_LINES) rec.lines.splice(0, rec.lines.length - RING_MAX_LINES);
  // Re-insert to mark this job most-recently-active for eviction ordering.
  if (prev) ring.delete(jobId);
  ring.set(jobId, rec);
  if (ring.size > RING_MAX_JOBS) {
    const oldest = ring.keys().next().value as string | undefined;
    if (oldest && oldest !== jobId) ring.delete(oldest);
  }
}

/** Retained log lines for one job instance, oldest first (empty if none/aged out). */
export function getJobLog(jobId: string): JobLogEntry[] {
  return ring.get(jobId)?.lines ?? [];
}

/** Index of jobs that currently have retained logs, most-recently-active first. */
export function listJobLogs(): JobLogSummary[] {
  const out: JobLogSummary[] = [];
  for (const [jobId, rec] of ring) {
    const last = rec.lines[rec.lines.length - 1];
    out.push({
      jobId,
      label: rec.label,
      count: rec.lines.length,
      lastTs: last?.ts ?? 0,
      lastLine: last?.line ?? "",
    });
  }
  return out.reverse(); // Map is oldest-first; callers want most-recent first.
}

const LEVELS = ["log", "info", "warn", "error", "debug"] as const;
type ConsoleMethod = (typeof LEVELS)[number];

let installed = false;
let inTap = false;
const original: Partial<Record<ConsoleMethod, (...a: any[]) => void>> = {};

/** Render console args to a single line the way console itself would. */
export function formatLogLine(args: unknown[]): string {
  let line: string;
  try {
    line = format(...(args as [unknown, ...unknown[]]));
  } catch {
    line = args.map((a) => String(a)).join(" ");
  }
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
}

const methodLevel = (m: ConsoleMethod): "info" | "warn" | "error" =>
  m === "warn" ? "warn" : m === "error" ? "error" : "info";

function emitLine(ctx: JobLogCtx, level: "info" | "warn" | "error", args: unknown[]) {
  const now = Date.now();
  if (now - ctx.windowStart >= RATE_WINDOW_MS) {
    ctx.windowStart = now;
    ctx.count = 0;
  }
  ctx.count++;
  if (ctx.count > RATE_MAX) {
    // Emit the "dropping" notice exactly once per window, then stay silent.
    if (ctx.count === RATE_MAX + 1) {
      publish(ctx, "warn", "… log rate-limited (too many lines/s)");
    }
    return;
  }
  publish(ctx, level, formatLogLine(args));
}

/** Retain a line in the ring and fan it out over the socket, sharing one seq/ts. */
function publish(ctx: JobLogCtx, level: "info" | "warn" | "error", line: string) {
  const entry: JobLogEntry = { seq: ++seqCounter, ts: Date.now(), level, line };
  retain(ctx.jobId, ctx.label, entry);
  emitWorkerEvent({
    type: QUEUE_LOG_TYPE,
    jobId: ctx.jobId,
    source: "queue",
    data: { jobId: ctx.jobId, label: ctx.label, seq: entry.seq, ts: entry.ts, level, line },
  });
}

/** Run a job handler with per-job console capture active. */
export function runInJobLogContext<T>(meta: { jobId: string; label: string }, fn: () => Promise<T>): Promise<T> {
  return als.run({ jobId: meta.jobId, label: meta.label, windowStart: 0, count: 0 }, fn);
}

/**
 * Patch `console.*` once so lines emitted inside a job context are streamed as
 * `queue:log`. Returns an uninstall fn. Re-entrancy guarded so the emit path
 * (which may itself log) can't recurse, and every capture is wrapped so logging
 * never breaks a job.
 */
export function installJobConsoleTap(): () => void {
  if (installed) return () => {};
  installed = true;

  for (const m of LEVELS) {
    const orig = (console as any)[m]?.bind(console) as ((...a: any[]) => void) | undefined;
    original[m] = orig;
    (console as any)[m] = (...args: unknown[]) => {
      if (orig) orig(...args);
      if (inTap) return;
      const ctx = als.getStore();
      if (!ctx) return;
      inTap = true;
      try {
        emitLine(ctx, methodLevel(m), args);
      } catch {
        /* never let streaming break a job */
      } finally {
        inTap = false;
      }
    };
  }

  return function uninstall() {
    for (const m of LEVELS) if (original[m]) (console as any)[m] = original[m]!;
    installed = false;
  };
}

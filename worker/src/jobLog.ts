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
      emitWorkerEvent({
        type: QUEUE_LOG_TYPE,
        jobId: ctx.jobId,
        source: "queue",
        data: { jobId: ctx.jobId, label: ctx.label, level: "warn", line: "… log rate-limited (too many lines/s)" },
      });
    }
    return;
  }
  emitWorkerEvent({
    type: QUEUE_LOG_TYPE,
    jobId: ctx.jobId,
    source: "queue",
    data: { jobId: ctx.jobId, label: ctx.label, level, line: formatLogLine(args) },
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

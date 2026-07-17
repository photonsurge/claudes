"use client";

/**
 * Per-job log buffer for /admin/queue. The worker streams a job's own console
 * output as `queue:log` (jobId + line) — the shared "Live events" console shows
 * them interleaved for every job, but a QueueJob card wants ONLY its own
 * instance's lines, live, while it's expanded.
 *
 * This is a tiny module-level external store keyed by jobId. One collector
 * (mounted once on the page) feeds it from the socket; each card reads its slice
 * via `useJobLog(jobId)` through useSyncExternalStore, so a new line re-renders
 * only the one card it belongs to — closed cards and the rest of the list stay
 * inert.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface JobLogLine {
  at: number;
  level: "info" | "warn" | "error";
  line: string;
}

// Lines kept per job, and jobs kept overall — both bounded so a long session or
// a chatty run can't grow this without limit. Insertion-order eviction (Map
// keeps insertion order) drops the oldest job once we exceed MAX_JOBS.
const MAX_LINES = 200;
const MAX_JOBS = 300;

const buffers = new Map<string, JobLogLine[]>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY: JobLogLine[] = [];

/** Append a line for a job and notify only that job's subscribers. */
export function pushJobLog(jobId: string, entry: JobLogLine): void {
  const prev = buffers.get(jobId) ?? EMPTY;
  // New array each push (immutable snapshot) so getSnapshot returns a stable
  // reference until the next line — unchanged jobs never re-render.
  const next = prev.length >= MAX_LINES ? [...prev.slice(1), entry] : [...prev, entry];
  // Re-insert to move this jobId to the end (most-recently-active) for eviction.
  buffers.delete(jobId);
  buffers.set(jobId, next);
  if (buffers.size > MAX_JOBS) {
    const oldest = buffers.keys().next().value as string | undefined;
    if (oldest && oldest !== jobId) buffers.delete(oldest);
  }
  listeners.get(jobId)?.forEach((l) => l());
}

function subscribe(jobId: string, cb: () => void): () => void {
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) listeners.delete(jobId);
  };
}

function getSnapshot(jobId: string): JobLogLine[] {
  return buffers.get(jobId) ?? EMPTY;
}

/** Live log lines for one BullMQ job instance, oldest first. */
export function useJobLog(jobId: string): JobLogLine[] {
  return useSyncExternalStore(
    useCallback((cb) => subscribe(jobId, cb), [jobId]),
    () => getSnapshot(jobId),
    () => EMPTY,
  );
}

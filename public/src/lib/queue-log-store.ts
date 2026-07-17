"use client";

/**
 * Per-job log buffer for /admin/queue. A job's own console output reaches the
 * browser two ways: live over the socket as `queue:log` (the worker streams each
 * line as it's emitted), and on demand via /api/admin/queue/log (the worker's
 * retained ring, pulled when a card is expanded so it can backfill lines it
 * missed). Both carry a process-global `seq` per line, so this store merges them
 * by seq — no duplicates when a line arrives from both sources.
 *
 * It's a tiny module-level external store keyed by jobId. A card reads its slice
 * via `useJobLog(jobId)` through useSyncExternalStore, so a new line re-renders
 * only the one card it belongs to — closed cards and the rest of the list stay
 * inert. Bounded per-job and overall so a long session can't grow it unbounded.
 */
import { useCallback, useSyncExternalStore } from "react";

export interface JobLogLine {
  seq: number;
  ts: number;
  level: "info" | "warn" | "error";
  line: string;
}

const MAX_LINES = 200;
const MAX_JOBS = 300;

const buffers = new Map<string, JobLogLine[]>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY: JobLogLine[] = [];

/** Merge lines into a job's buffer (deduped + sorted by seq), notifying readers. */
export function mergeJobLog(jobId: string, incoming: JobLogLine[]): void {
  if (incoming.length === 0) return;
  const prev = buffers.get(jobId) ?? EMPTY;
  const bySeq = new Map<number, JobLogLine>();
  for (const l of prev) bySeq.set(l.seq, l);
  let changed = false;
  for (const l of incoming) {
    if (!bySeq.has(l.seq)) changed = true;
    bySeq.set(l.seq, l);
  }
  if (!changed) return; // nothing new — keep the stable reference (no re-render)
  let next = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  if (next.length > MAX_LINES) next = next.slice(next.length - MAX_LINES);
  // Re-insert to mark this job most-recently-active for eviction ordering.
  buffers.delete(jobId);
  buffers.set(jobId, next);
  if (buffers.size > MAX_JOBS) {
    const oldest = buffers.keys().next().value as string | undefined;
    if (oldest && oldest !== jobId) buffers.delete(oldest);
  }
  listeners.get(jobId)?.forEach((l) => l());
}

/** Append one live line (from the socket). */
export function pushJobLog(jobId: string, entry: JobLogLine): void {
  mergeJobLog(jobId, [entry]);
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

/** Live + backfilled log lines for one BullMQ job instance, oldest first. */
export function useJobLog(jobId: string): JobLogLine[] {
  return useSyncExternalStore(
    useCallback((cb) => subscribe(jobId, cb), [jobId]),
    () => getSnapshot(jobId),
    () => EMPTY,
  );
}

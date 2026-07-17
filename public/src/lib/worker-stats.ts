// lib/worker-stats.ts
// Shape of the worker /status payload, proxied by /api/admin/worker-stats and
// rendered on /admin/health. Kept here so the page, its child components and the
// route test all agree on one contract. Mirrors what worker/src/index.ts emits.

/** One queue lane: its BullMQ name, effective concurrency cap, and job counts. */
export interface WorkerTierStat {
  tier: "foreground" | "mid" | "background" | string;
  name: string;
  /** Effective Worker concurrency (env override or the tuned default). */
  concurrency: number;
  counts: Record<string, number>;
}

/** Per-event usage ledger row — peak memory + timing each job label has run with. */
export interface WorkerEventStat {
  /** "type.event", or "type.event:source" where the type registers per-source. */
  label: string;
  runs: number;
  errors: number;
  totalMs: number;
  peakMs: number;
  lastMs: number;
  avgMs: number;
  peakHeapDeltaMB: number;
  peakRssMB: number;
}

/**
 * Bake-thread pool lifecycle (worker/src/grib/bakePool.ts). Each bake thread is
 * a whole V8 isolate whose memory shows only in rss — so `threads`×(idle heap)
 * is a big slice of the rss-vs-heap gap, `recycled` counts memory handed back
 * to the OS, and `crashed` > 0 means bakes are dying (check worker logs;
 * `worker`=0 with `inline`>0 = the pool is broken/off and bakes run on the loop).
 */
export interface WorkerBakePoolStats {
  /** Bakes served by a worker thread (the offload working). */
  worker: number;
  /** Bakes served inline on the main loop (fallback / BAKE_POOL=off). */
  inline: number;
  spawned: number;
  recycled: number;
  crashed: number;
  /** Threads alive right now. */
  threads?: number;
  /** Tasks waiting for a thread. */
  queued?: number;
}

/**
 * /api/public-stats — the PUBLIC app's own memory readout (that route runs in
 * this very process). A small steady heap under a fat nativeGap = the glibc/
 * sharp plateau, not a leak; a steadily climbing heapUsedMB is the real thing.
 */
export interface PublicStats {
  status: "ok" | "down";
  rssMB?: number;
  heapUsedMB?: number;
  heapTotalMB?: number;
  heapLimitMB?: number;
  externalMB?: number;
  arrayBuffersMB?: number;
  /** rss minus everything V8 accounts for ≈ native (sharp/glibc arenas). */
  nativeGapMB?: number;
  uptimeSec?: number;
}

export interface WorkerStats {
  status: "ok" | "down" | "error";
  error?: string;
  queues?: Record<string, string>;
  counts?: Record<string, number>;
  byTier?: WorkerTierStat[];
  /** Resident set size — the OS-visible footprint, what an OOM-kill measures. */
  rssMB?: number;
  /** rss high-water mark since worker boot. */
  rssPeakMB?: number;
  /** JS heap in use. */
  heapUsedMB?: number;
  heapTotalMB?: number;
  /** V8 old-space ceiling — the hard limit the 4GB OOM crashed into. */
  heapLimitMB?: number;
  externalMB?: number;
  /** Bake-thread pool lifecycle counters (see WorkerBakePoolStats). */
  bakePool?: WorkerBakePoolStats;
  uptimeSec?: number;
  /** Labels (type.event[:source]) of jobs running right now — live, not the ledger. */
  active?: string[];
  events?: WorkerEventStat[];
  time?: string;
}

/** Sum a tier's not-yet-running work (waiting + prioritized + delayed). */
export function pendingOf(counts: Record<string, number>): number {
  return (counts.waiting ?? 0) + (counts.prioritized ?? 0) + (counts.delayed ?? 0);
}

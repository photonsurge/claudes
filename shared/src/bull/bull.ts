/**
 * BullMQ/Redis connection plumbing shared by producers (sendToQueue) and the
 * worker. Exposes `getRedisOptions` (the one place Redis connection opts live)
 * and lazily-built, globally-cached `getQueue` / `getQueueEvents` singletons so a
 * single Queue/QueueEvents pair is reused across hot reloads and modules.
 */
import { Job, Queue, QueueEvents } from "bullmq";
import { getEnvVar } from "../utill/env";
import { DEFAULT_TIER, QUEUE_NAMES, QUEUE_TIERS, type QueueTier } from "../utill/bull-utils";

declare global {
  // eslint-disable-next-line no-var
  var __queues__: Partial<Record<QueueTier, Queue>> | undefined;
  // eslint-disable-next-line no-var
  var __queueEventsByTier__: Partial<Record<QueueTier, QueueEvents>> | undefined;
}

// Single place for the Redis connection options.
export function getRedisOptions() {
  return {
    host: getEnvVar("REDIS_SERVER") ?? "127.0.0.1",
    port: Number(getEnvVar("REDIS_PORT") ?? 6379),
    password: getEnvVar("REDIS_PASSWORD") || undefined,
    family: 4,
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  } as const;
}

/**
 * The Queue for a tier (default MID — its name is the historical "worker-app", so
 * every `getQueue().client` reader and existing Redis schedule carries on). One
 * cached singleton per tier, reused across hot reloads.
 */
export function getQueue(tier: QueueTier = DEFAULT_TIER): Queue {
  const cache = (global.__queues__ ??= {});
  const hit = cache[tier];
  if (hit) return hit;
  const q = new Queue(QUEUE_NAMES[tier], { connection: getRedisOptions() });
  cache[tier] = q;
  return q;
}

/** Every tier's Queue, for the admin/cancel/clear paths that must sweep all three. */
export function getAllQueues(): { tier: QueueTier; queue: Queue }[] {
  return QUEUE_TIERS.map((tier) => ({ tier, queue: getQueue(tier) }));
}

export function getQueueEvents(tier: QueueTier = DEFAULT_TIER): QueueEvents {
  const cache = (global.__queueEventsByTier__ ??= {});
  const hit = cache[tier];
  if (hit) return hit;
  const qe = new QueueEvents(QUEUE_NAMES[tier], { connection: getRedisOptions() });
  cache[tier] = qe;
  return qe;
}

/** Job counts summed across every tier's queue (the admin header total). */
export async function aggregateJobCounts(states: string[]): Promise<Record<string, number>> {
  const per = await Promise.all(getAllQueues().map(({ queue }) => queue.getJobCounts(...(states as any[]))));
  const out: Record<string, number> = {};
  for (const c of per) for (const s of states) out[s] = (out[s] ?? 0) + ((c as Record<string, number>)[s] ?? 0);
  return out;
}

/** Find a job by id across all tiers — a jobId lives on exactly one queue, unknown which. */
export async function findJobAcrossTiers(jobId: string): Promise<Job | null> {
  for (const { queue } of getAllQueues()) {
    const job = await queue.getJob(jobId);
    if (job) return job;
  }
  return null;
}

/** Jobs in the given states across all tiers (for the "already queued?" scans). */
export async function getJobsAcrossTiers(states: any[], start = 0, end = 100): Promise<Job[]> {
  const per = await Promise.all(getAllQueues().map(({ queue }) => queue.getJobs(states, start, end, false)));
  return per.flat();
}

// Every job state `clean()` accepts, i.e. the whole queue. Note BullMQ names the
// waiting set "wait" here even though `getJobCounts` calls it "waiting"; callers
// may pass either spelling and `normalizeStates` folds them together.
export const CLEANABLE_STATES = [
  "active",
  "wait",
  "prioritized",
  "paused",
  "delayed",
  "failed",
  "completed",
] as const;

export type ClearableState = (typeof CLEANABLE_STATES)[number];

// clean() removes at most `limit` per call, so we loop per state until a pass
// comes back short rather than capping the purge at one batch.
const CLEAN_BATCH = 5_000;

// The states whose jobs BullMQ guards when they belong to a job scheduler (see
// cleanList/cleanSet → isJobSchedulerJob). `completed`/`failed` are absent on
// purpose: the Lua passes no repeat key for those, so they always clean, and a
// scheduler must never be unarmed just because one of its past runs finished.
const GUARDED_STATES: readonly ClearableState[] = ["active", "wait", "prioritized", "paused", "delayed"];

// `clean()` takes "wait"; `getJobs()` takes "waiting" for the same set.
const JOB_STATE: Record<ClearableState, string> = {
  active: "active",
  wait: "waiting",
  prioritized: "prioritized",
  paused: "paused",
  delayed: "delayed",
  failed: "failed",
  completed: "completed",
};

export type ClearQueueResult = {
  removed: Record<string, number>;
  /** How many schedules were unarmed to make their jobs removable. */
  schedulers: number;
};

/**
 * Map caller-supplied state names onto the ones `clean()` takes, dropping
 * anything unrecognised. Preserves CLEANABLE_STATES order (not the caller's) and
 * de-dupes, so `["waiting","wait"]` cleans the waiting set once.
 */
export function normalizeStates(states?: readonly string[]): ClearableState[] {
  if (!states?.length) return [...CLEANABLE_STATES];
  const want = new Set(states.map((s) => (s === "waiting" ? "wait" : s)));
  return CLEANABLE_STATES.filter((s) => want.has(s));
}

/**
 * Purge the Redis queue: removes jobs in the given states, or every state when
 * `states` is omitted.
 *
 * A plain `clean()` is not enough. BullMQ refuses to remove the job a repeatable
 * schedule currently has armed — `clean()` skips it silently, `job.remove()`
 * throws, `drain()` leaves it — so on a queue whose backlog IS the schedules
 * (the usual case here: every waiting job is a `repeat:<key>:<ms>`), clearing
 * removes nothing. So we unarm first: drop the schedules owning jobs in the
 * target states, which un-guards those jobs, THEN clean. Order matters —
 * removing a schedule does not delete a job already promoted to `wait`, it only
 * makes it cleanable.
 *
 * Two consequences worth surfacing to whoever pushed the button:
 *  - Unarmed schedules do NOT come back on their own. The worker re-registers
 *    every repeatable at boot (worker/src/index.ts), so a restart restores them;
 *    until then that scheduled work does not fire. `schedulers` in the result
 *    says how many went, so callers can say so.
 *  - Removing an ACTIVE job only deletes its record; BullMQ can't preempt a
 *    handler that's already running, so in-flight work still runs to completion.
 *    Pause the queue first if you want it to stay empty.
 *
 * Pass `{ force: false }` for the timid version: clean only, schedules untouched,
 * armed jobs left behind.
 */
export async function clearQueue({
  states,
  force = true,
}: { states?: readonly string[]; force?: boolean } = {}): Promise<ClearQueueResult> {
  const targets = normalizeStates(states);
  const removed: Record<string, number> = {};
  let schedulers = 0;

  // Sweep every tier — the work is spread across three queues now, so clearing
  // just one would silently leave the others armed.
  for (const { queue } of getAllQueues()) {
    const r = await clearOneQueue(queue, targets, force);
    schedulers += r.schedulers;
    for (const state of targets) removed[state] = (removed[state] ?? 0) + (r.removed[state] ?? 0);
  }

  return { removed, schedulers };
}

/**
 * Purge one queue's given states (unarming any schedule that would otherwise guard
 * a target job). The per-queue half of `clearQueue`, split out so it's unit-testable
 * against a stub queue without three-tier bookkeeping.
 */
export async function clearOneQueue(
  q: Queue,
  targets: ClearableState[],
  force: boolean,
): Promise<ClearQueueResult> {
  await q.waitUntilReady();
  const schedulers = force ? await unarmSchedulers(q, targets) : 0;

  const removed: Record<string, number> = {};
  for (const state of targets) {
    let total = 0;
    for (;;) {
      // grace = 0 → purge regardless of job age.
      const ids = await q.clean(0, CLEAN_BATCH, state);
      total += ids.length;
      if (ids.length < CLEAN_BATCH) break;
    }
    removed[state] = total;
  }
  return { removed, schedulers };
}

/**
 * Remove the schedules that own an armed job in `targets`, so those jobs stop
 * being guarded. Only guarded states are scanned — a scheduler is never dropped
 * on account of a completed or failed past run.
 */
async function unarmSchedulers(q: Queue, targets: readonly ClearableState[]): Promise<number> {
  const scan = targets.filter((s) => GUARDED_STATES.includes(s));
  if (!scan.length) return 0;

  const jobs = await q.getJobs(scan.map((s) => JOB_STATE[s]) as any, 0, -1, false);
  const keys = new Set<string>();
  for (const job of jobs) {
    const key = (job as any)?.repeatJobKey;
    if (key) keys.add(key);
  }

  let count = 0;
  for (const key of keys) {
    try {
      await q.removeJobScheduler(key);
      count++;
    } catch {
      // Schedules registered via the legacy `add({ repeat, jobId })` API.
      try {
        await q.removeRepeatableByKey(key);
        count++;
      } catch {
        /* already gone — nothing to unarm */
      }
    }
  }
  return count;
}

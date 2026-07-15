/**
 * BullMQ/Redis connection plumbing shared by producers (sendToQueue) and the
 * worker. Exposes `getRedisOptions` (the one place Redis connection opts live)
 * and lazily-built, globally-cached `getQueue` / `getQueueEvents` singletons so a
 * single Queue/QueueEvents pair is reused across hot reloads and modules.
 */
import { Queue, QueueEvents } from "bullmq";
import { getEnvVar } from "../utill/env";
import { QUEUE_NAME } from "../utill/bull-utils";

declare global {
  // eslint-disable-next-line no-var
  var __queue__: Queue | undefined;
  // eslint-disable-next-line no-var
  var __queueEvents__: QueueEvents | undefined;
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

export function getQueue() {
  if (global.__queue__) return global.__queue__;
  const q = new Queue(QUEUE_NAME, { connection: getRedisOptions() });
  global.__queue__ = q;
  return q;
}

export function getQueueEvents() {
  if (global.__queueEvents__) return global.__queueEvents__;
  const qe = new QueueEvents(QUEUE_NAME, { connection: getRedisOptions() });
  global.__queueEvents__ = qe;
  return qe;
}

// Every job state `clean()` accepts, i.e. the whole queue. Note BullMQ names the
// waiting set "wait" here even though `getJobCounts` calls it "waiting".
const CLEANABLE_STATES = [
  "active",
  "wait",
  "prioritized",
  "paused",
  "delayed",
  "failed",
  "completed",
] as const;

// clean() removes at most `limit` per call, so we loop per state until a pass
// comes back short rather than capping the purge at one batch.
const CLEAN_BATCH = 5_000;

export type ClearQueueResult = {
  removed: Record<string, number>;
  schedulers: number;
};

/**
 * Purge the Redis queue: removes every job in every state.
 *
 * Two things it deliberately does NOT do:
 *  - Repeatable schedules survive by default, so cron-style jobs re-arm on their
 *    next tick. Pass `{ schedulers: true }` to remove those too (they only come
 *    back when the worker restarts and re-registers them).
 *  - Removing an ACTIVE job only deletes its record; BullMQ can't preempt a
 *    handler that's already running, so in-flight work still runs to completion.
 *    Pause the queue first if you want it to stay empty.
 */
export async function clearQueue({ schedulers = false }: { schedulers?: boolean } = {}): Promise<ClearQueueResult> {
  const q = getQueue();
  await q.waitUntilReady();

  const removed: Record<string, number> = {};
  for (const state of CLEANABLE_STATES) {
    let total = 0;
    for (;;) {
      // grace = 0 → purge regardless of job age.
      const ids = await q.clean(0, CLEAN_BATCH, state);
      total += ids.length;
      if (ids.length < CLEAN_BATCH) break;
    }
    removed[state] = total;
  }

  let removedSchedulers = 0;
  if (schedulers) removedSchedulers = await removeAllSchedulers(q);

  return { removed, schedulers: removedSchedulers };
}

/** Remove every repeatable schedule, preferring the Job Scheduler API. */
async function removeAllSchedulers(q: Queue): Promise<number> {
  let count = 0;
  try {
    const list = await q.getJobSchedulers(0, -1, true);
    for (const s of list ?? []) {
      if (!s?.key) continue;
      await q.removeJobScheduler(s.key);
      count++;
    }
    if (count) return count;
  } catch {
    /* fall through to the legacy repeatable API */
  }
  const legacy = await q.getRepeatableJobs();
  for (const r of legacy ?? []) {
    if (!r?.key) continue;
    await q.removeRepeatableByKey(r.key);
    count++;
  }
  return count;
}

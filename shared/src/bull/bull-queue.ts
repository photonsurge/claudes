/**
 * Producer-side BullMQ helpers: the single way the rest of the stack enqueues
 * background work. Exports `sendToQueue` / `sendToQueueAndWait` plus the
 * `QUEUE_PRIORITY` levels. Jobs are pushed as `{ domain, type, event, data }`;
 * the worker (worker/src/index.ts) routes them to `src/jobs/<type>.ts#<event>`.
 *
 * DEDUP IS THE DEFAULT (see `dedupIdFor`): enqueueing a job identical to one
 * that's already waiting/active is a no-op that returns the pending job. The
 * fan-out producers (the events watcher, the per-alert snapshot loop) re-derive
 * their work from Mongo every tick, so without this a slow or backed-up consumer
 * gets the same job piled on once per tick, forever. Pass `{ dedupe: false }` for
 * the rare job that genuinely must run twice with identical input.
 */
import { createHash } from "crypto";
import { getQueue, getQueueEvents } from "./bull";

// Lower number = higher priority. Use QUEUE_PRIORITY constants.
export const QUEUE_PRIORITY = {
  HIGH: 1, // user-facing
  NORMAL: 5, // standard side-effects
  LOW: 10, // background bulk
} as const;

export type QueuePriority = (typeof QUEUE_PRIORITY)[keyof typeof QUEUE_PRIORITY];

export interface SendToQueueOpts {
  /**
   * `false` disables dedup for this call — use it only when two identical jobs
   * must BOTH run (i.e. the job's effect isn't a pure function of its payload).
   * A string sets the dedup id explicitly, for the case where the payload
   * carries a field that varies but shouldn't split the key.
   */
  dedupe?: boolean | string;
}

/**
 * Deterministic JSON: object keys sorted at every depth, so two callers building
 * the same payload with keys in a different order hash to the SAME id. Plain
 * `JSON.stringify` preserves insertion order, which would silently defeat dedup.
 * Arrays keep their order (it's meaningful); `undefined` members are dropped so
 * `{a: 1}` and `{a: 1, b: undefined}` agree; Dates go to ISO.
 */
export const stableStringify = (value: unknown): string => {
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(walk);
    return Object.keys(v as Record<string, unknown>)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = walk((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  };
  return JSON.stringify(walk(value)) ?? "null";
};

/**
 * The dedup key for a job: its full identity (`domain:type:event` + payload).
 * Readable prefix + a payload digest, so a wedged key is greppable in Redis
 * (`<prefix>:de:events:acquire:…`) rather than an opaque hash.
 *
 * Deliberately NOT paired with a `ttl`. BullMQ holds a ttl-less key only while
 * the job is waiting/active/delayed and drops it the moment the job completes,
 * fails, or is removed — which is exactly "don't pile up duplicates of pending
 * work". A ttl would instead keep the key alive AFTER completion, blocking the
 * next legitimate run for the whole window (the events watcher re-acquires on
 * sub-hour cadences, so that would silently stall it).
 */
export const dedupIdFor = (domain: string, type: string, event: string, data: unknown): string => {
  const digest = createHash("sha256").update(stableStringify({ domain, data })).digest("hex").slice(0, 16);
  return `${type}:${event}:${digest}`;
};

/**
 * Enqueue a job. Jobs are dispatched as `{ type, event, data }`; the worker
 * routes them to `src/jobs/<type>.ts` exported function `<event>`.
 *
 * `domain` is carried for forward-compatibility/log attribution but this is a
 * single-domain stack, so it is generally just a constant.
 *
 * Identical jobs dedup by default: if one is already waiting/active, this adds
 * nothing and hands back the PENDING job (so `sendToQueueAndWait` still resolves
 * with its result, rather than waiting on a job that was never created). Once it
 * finishes, the next identical call enqueues normally. Opt out with
 * `{ dedupe: false }` — see `SendToQueueOpts`.
 */
export const sendToQueue = async (
  domain: string,
  type: string,
  event: string,
  data: any,
  delayUntil?: Date,
  priority: QueuePriority = QUEUE_PRIORITY.NORMAL,
  opts: SendToQueueOpts = {},
) => {
  const q = getQueue();
  await q.waitUntilReady();

  const { dedupe = true } = opts;
  const dedupId = dedupe === false ? undefined : typeof dedupe === "string" ? dedupe : dedupIdFor(domain, type, event, data);
  const deduplication = dedupId ? { deduplication: { id: dedupId } } : {};

  if (delayUntil) {
    const delay = delayUntil.getTime() - Date.now();
    return q.add(
      "do",
      { domain, type, event, data },
      { delay: Math.max(delay, 0), priority, removeOnComplete: true, removeOnFail: true, ...deduplication },
    );
  }

  return q.add(
    "do",
    { domain, type, event, data },
    { attempts: 3, priority, removeOnComplete: { age: 3600 }, ...deduplication },
  );
};

/**
 * Enqueue and block until the job finishes (or times out). When an identical job
 * is already pending this attaches to THAT job rather than starting a second one,
 * so concurrent callers asking the same question share one answer.
 */
export const sendToQueueAndWait = async <T = unknown>(
  domain: string,
  type: string,
  event: string,
  data: any,
  timeoutMs = 15_000,
  priority: QueuePriority = QUEUE_PRIORITY.HIGH,
  opts: SendToQueueOpts = {},
): Promise<T> => {
  const job = await sendToQueue(domain, type, event, data, undefined, priority, opts);
  const result = await job.waitUntilFinished(getQueueEvents(), timeoutMs);
  return result as T;
};

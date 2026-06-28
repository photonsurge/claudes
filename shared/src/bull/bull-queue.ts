import { getQueue, getQueueEvents } from "./bull";

// Lower number = higher priority. Use QUEUE_PRIORITY constants.
export const QUEUE_PRIORITY = {
  HIGH: 1, // user-facing
  NORMAL: 5, // standard side-effects
  LOW: 10, // background bulk
} as const;

export type QueuePriority = (typeof QUEUE_PRIORITY)[keyof typeof QUEUE_PRIORITY];

/**
 * Enqueue a job. Jobs are dispatched as `{ type, event, data }`; the worker
 * routes them to `src/jobs/<type>.ts` exported function `<event>`.
 *
 * `domain` is carried for forward-compatibility/log attribution but this is a
 * single-domain stack, so it is generally just a constant.
 */
export const sendToQueue = async (
  domain: string,
  type: string,
  event: string,
  data: any,
  delayUntil?: Date,
  priority: QueuePriority = QUEUE_PRIORITY.NORMAL,
) => {
  const q = getQueue();
  await q.waitUntilReady();

  if (delayUntil) {
    const delay = delayUntil.getTime() - Date.now();
    return q.add(
      "do",
      { domain, type, event, data },
      { delay: Math.max(delay, 0), priority, removeOnComplete: true, removeOnFail: true },
    );
  }

  return q.add(
    "do",
    { domain, type, event, data },
    { attempts: 3, priority, removeOnComplete: { age: 3600 } },
  );
};

/** Enqueue and block until the job finishes (or times out). */
export const sendToQueueAndWait = async <T = unknown>(
  domain: string,
  type: string,
  event: string,
  data: any,
  timeoutMs = 15_000,
  priority: QueuePriority = QUEUE_PRIORITY.HIGH,
): Promise<T> => {
  const job = await sendToQueue(domain, type, event, data, undefined, priority);
  const result = await job.waitUntilFinished(getQueueEvents(), timeoutMs);
  return result as T;
};

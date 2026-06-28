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

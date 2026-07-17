// queueEventBridge.ts
// Subscribes to BullMQ's `QueueEvents` (Redis pub/sub of the queue lifecycle:
// added → waiting → active → completed/failed …) and re-emits each one up to the
// socket server as a `queue:event` `worker:event`. The relay fans those out to
// the public room, so /admin/queue can show a *live* console of jobs as they
// happen — the 4s snapshot poll misses transient jobs that come and go between
// ticks. The worker is the natural observer here: it already holds the
// QueueEvents/Redis connection and the socket client.
import type { Queue } from "bullmq";
import { getAllQueues, getQueueEvents } from "@photonsurge/shared/bull/bull";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "./socket";

const TAG = "queue-events";

/** Fan-out event name browsers listen for (see socket relay: payload.type). */
export const QUEUE_EVENT_TYPE = "queue:event";

// The BullMQ QueueEvents we relay, in rough lifecycle order.
const RELAYED_EVENTS = [
  "added",
  "waiting",
  "active",
  "progress",
  "completed",
  "failed",
  "retries-exhausted",
  "delayed",
  "stalled",
  "removed",
  "drained",
  "cleaned",
  "paused",
  "resumed",
] as const;

export type QueuePhase = (typeof RELAYED_EVENTS)[number];

export interface QueueEventPayload {
  phase: QueuePhase;
  jobId: string | null;
  extra: Record<string, unknown>;
}

/**
 * Pure mapping from a raw BullMQ QueueEvents `(event, args)` to the normalized
 * shape we fan out. Kept side-effect-free so it's unit-testable without Redis.
 * Returns null for events we don't relay. `failedReason` is truncated so a huge
 * stack never bloats the socket frame.
 */
export function queueEventToPayload(event: string, args: any): QueueEventPayload | null {
  if (!(RELAYED_EVENTS as readonly string[]).includes(event)) return null;
  const jobId = typeof args?.jobId === "string" ? args.jobId : null;
  switch (event as QueuePhase) {
    case "added":
      return { phase: "added", jobId, extra: { name: args?.name ?? null } };
    case "waiting":
      return { phase: "waiting", jobId, extra: {} };
    case "active":
      return { phase: "active", jobId, extra: { prev: args?.prev ?? null } };
    case "progress":
      return { phase: "progress", jobId, extra: { progress: args?.data ?? null } };
    case "completed":
      return { phase: "completed", jobId, extra: {} };
    case "failed":
      return {
        phase: "failed",
        jobId,
        extra: {
          failedReason:
            typeof args?.failedReason === "string" ? args.failedReason.slice(0, 500) : (args?.failedReason ?? null),
          prev: args?.prev ?? null,
        },
      };
    case "retries-exhausted":
      return { phase: "retries-exhausted", jobId, extra: { attemptsMade: args?.attemptsMade ?? null } };
    case "delayed":
      return { phase: "delayed", jobId, extra: { delay: args?.delay ?? null } };
    case "stalled":
      return { phase: "stalled", jobId, extra: {} };
    case "removed":
      return { phase: "removed", jobId, extra: { prev: args?.prev ?? null } };
    case "drained":
      return { phase: "drained", jobId: null, extra: {} };
    case "cleaned":
      return { phase: "cleaned", jobId: null, extra: { count: Number(args?.count) || 0 } };
    case "paused":
      return { phase: "paused", jobId: null, extra: {} };
    case "resumed":
      return { phase: "resumed", jobId: null, extra: {} };
    default:
      return null;
  }
}

// jobId → "type.event" label. BullMQ's QueueEvents payloads only carry the raw
// jobId, so we peek at the job once to give the live log a meaningful name
// (e.g. "weather.check" not "#1234"). Cached because a single job fires several
// phases (added → active → completed) and `removeOnComplete` may delete it
// before the terminal event lands — the cache preserves the label either way.
const labelCache = new Map<string, string>();
const LABEL_CACHE_MAX = 1000;

async function resolveLabel(q: Queue, jobId: string | null): Promise<string | null> {
  if (!jobId) return null;
  const cached = labelCache.get(jobId);
  if (cached) return cached;
  try {
    const job = await q.getJob(jobId);
    const d = job?.data as { type?: string; event?: string } | undefined;
    if (d?.type && d?.event) {
      const label = `${d.type}.${d.event}`;
      if (labelCache.size >= LABEL_CACHE_MAX) {
        const oldest = labelCache.keys().next().value;
        if (oldest !== undefined) labelCache.delete(oldest);
      }
      labelCache.set(jobId, label);
      return label;
    }
  } catch {
    /* job already gone (removeOnComplete) or redis blip — fall back to jobId */
  }
  return null;
}

/**
 * Attach the relay listeners to the shared QueueEvents singleton. Returns a stop
 * fn that detaches them (used on graceful shutdown). Safe to call once at boot.
 */
export function startQueueEventBridge(): () => void {
  // One relay per tier — work is spread across three queues now, so listening to
  // only one would drop every foreground/background job from the /admin console.
  // Each relay resolves labels against ITS OWN queue (jobIds aren't unique across
  // queues, and getJob must hit the right one).
  const detachers: (() => void)[] = [];

  for (const { tier, queue: q } of getAllQueues()) {
    const qe = getQueueEvents(tier);

    const relay = (payload: QueueEventPayload) => {
      // Terminal phases free the label cache entry after use.
      const terminal = payload.phase === "completed" || payload.phase === "failed" || payload.phase === "removed";
      resolveLabel(q, payload.jobId)
        .then((label) => {
          emitWorkerEvent({
            type: QUEUE_EVENT_TYPE,
            jobId: payload.jobId ?? undefined,
            source: "queue",
            data: { phase: payload.phase, jobId: payload.jobId, label, tier, ...payload.extra },
          });
          if (terminal && payload.jobId) labelCache.delete(payload.jobId);
        })
        .catch((err) => log(TAG, "relay failed", err));
    };

    const handlers = RELAYED_EVENTS.map((event) => {
      const handler = (args: any) => {
        const payload = queueEventToPayload(event, args);
        if (payload) relay(payload);
      };
      qe.on(event as any, handler);
      return [event, handler] as const;
    });
    detachers.push(() => {
      for (const [event, handler] of handlers) qe.off(event as any, handler);
    });
  }

  log(TAG, "queue event bridge started", { events: [...RELAYED_EVENTS], tiers: getAllQueues().length });

  return function stop() {
    for (const detach of detachers) detach();
    labelCache.clear();
    log(TAG, "queue event bridge stopped");
  };
}

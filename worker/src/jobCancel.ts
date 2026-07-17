// jobCancel.ts
// Operator "cancel job" support. BullMQ can't force-kill a running handler (it's
// just a Promise in this process), so cancelling an ACTIVE job is cooperative:
// the worker keeps an AbortController per running job, and cancelling aborts it +
// discards the job so it won't retry. A handler opts in by checking
// `jobAbortSignal(job)` at safe points. Not-yet-started jobs are cancelled by the
// public route removing them outright — this module only handles the active case.
//
// The cancel request originates in the PUBLIC process (the /admin/queue route),
// so it reaches us over a Redis pub/sub channel (`<queue>:cancel`), carrying the
// jobId. `job.discard()` is in-memory only in BullMQ, so it MUST run here on the
// worker's own job instance — hence the round trip.
import { getQueue } from "@photonsurge/shared/bull/bull";
import { jobLabel } from "@photonsurge/shared/jobs";
import { QUEUE_NAME } from "@photonsurge/shared/utill/bull-utils";
import { log } from "@photonsurge/shared/utill/logger";
import { emitWorkerEvent } from "./socket";
import { QUEUE_LOG_TYPE } from "./jobLog";

const TAG = "queue-cancel";

/** Redis pub/sub channel the public route publishes cancel requests on. */
export const cancelChannel = (): string => `${QUEUE_NAME}:cancel`;

interface CancellableJob {
  id?: string | number | null;
  data?: { type?: string; event?: string } & Record<string, unknown>;
  discard?: () => void;
}

interface Entry {
  controller: AbortController;
  job: CancellableJob;
}

const active = new Map<string, Entry>();

/** Register a running job so it can be cancelled; returns its abort signal. */
export function beginJob(jobId: string, job: CancellableJob): AbortSignal {
  const controller = new AbortController();
  active.set(jobId, { controller, job });
  return controller.signal;
}

/** Deregister a job once it has settled. */
export function endJob(jobId: string): void {
  active.delete(jobId);
}

/**
 * Labels of the jobs running RIGHT NOW (type.event, or type.event:source) — the
 * live counterpart to the eventStats ledger, which only records FINISHED runs.
 * Surfaced on /status so the queue page can flag which event types are in flight.
 */
export function activeJobLabels(): string[] {
  return [...active.values()].map(
    (e) => jobLabel(e.job.data) ?? `${e.job.data?.type ?? "unknown"}.${e.job.data?.event ?? "unknown"}`,
  );
}

/**
 * Handler ergonomics: the abort signal for the currently-running job, so a
 * long-running handler can `if (jobAbortSignal(job)?.aborted) return` or pass it
 * to `fetch(url, { signal })`. Undefined once the job has settled.
 */
export function jobAbortSignal(job: { id?: string | number | null }): AbortSignal | undefined {
  return job?.id != null ? active.get(String(job.id))?.controller.signal : undefined;
}

/**
 * Abort a running job's signal and mark it discarded (no retry). Returns whether
 * the job was actually active here. A no-op abort for handlers that don't check
 * the signal — they run to completion, which is the honest limitation.
 */
export function cancelJob(jobId: string): boolean {
  const entry = active.get(jobId);
  if (!entry) return false;
  entry.controller.abort();
  try {
    // In-memory flag on THIS worker's instance → if the handler now throws, the
    // job moves to failed without being retried.
    entry.job.discard?.();
  } catch {
    /* ignore */
  }
  const d = entry.job.data;
  const label = d?.type && d?.event ? `${d.type}.${d.event}` : `#${jobId}`;
  emitWorkerEvent({
    type: QUEUE_LOG_TYPE,
    jobId,
    source: "queue",
    data: {
      jobId,
      label,
      level: "warn",
      line: "⚑ cancel requested — aborting (cooperative: takes effect only where the handler honors the abort signal)",
    },
  });
  return true;
}

/**
 * Subscribe (on a dedicated duplicated connection — a subscriber can't issue
 * normal commands) to the cancel channel and abort matching active jobs. Returns
 * a stop fn.
 */
export async function startCancelSubscriber(): Promise<() => void> {
  const q = getQueue();
  const client: any = await (q as any).client;
  const sub: any = client.duplicate();
  const channel = cancelChannel();
  await sub.subscribe(channel);

  const onMessage = (ch: string, message: string) => {
    if (ch !== channel) return;
    const found = cancelJob(message);
    log(TAG, "cancel message", { jobId: message, found });
  };
  sub.on("message", onMessage);
  log(TAG, "cancel subscriber started", { channel });

  return function stop() {
    try {
      sub.off("message", onMessage);
      sub.quit();
    } catch {
      /* ignore */
    }
  };
}

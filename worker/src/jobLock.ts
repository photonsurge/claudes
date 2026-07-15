import { log } from "@photonsurge/shared/utill/logger";

/**
 * Keep long repeatable jobs from stacking on top of each other.
 *
 * A repeatable job fires on its interval regardless of whether the previous run
 * finished. When a job runs longer than its interval — volcano media walks a lot
 * of volcanoes and a lot of providers — copies pile up and run concurrently:
 * three `officialMedia` runs at once means three times the requests at the same
 * provider, all racing to write the same rows.
 *
 * Jobs sharing a key run one at a time. A run that arrives while the key is held
 * SKIPS rather than queues: these are periodic refreshes, so the next tick will
 * pick the work up anyway, and queueing would just build a backlog that never
 * drains (the thing we're trying to stop).
 *
 * In-process only, which is enough: the worker is a single process. If it dies
 * mid-run the lock dies with it, which is the right outcome — nothing to unstick.
 */
const held = new Set<string>();

export interface Skipped {
  skipped: true;
  reason: string;
  lock: string;
}

export const wasSkipped = (r: unknown): r is Skipped =>
  typeof r === "object" && r !== null && (r as Skipped).skipped === true;

export async function runExclusive<T>(
  key: string,
  tag: string,
  fn: () => Promise<T>,
): Promise<T | Skipped> {
  if (held.has(key)) {
    const result: Skipped = { skipped: true, reason: `another ${key} job is still running`, lock: key };
    log(tag, `skipped: ${key} lock held`, result);
    return result;
  }
  held.add(key);
  try {
    return await fn();
  } finally {
    held.delete(key);
  }
}

/** Test seam: drop any held locks between cases. */
export const __resetJobLocks = () => held.clear();

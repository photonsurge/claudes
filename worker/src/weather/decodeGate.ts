// weather/decodeGate.ts
// Process-wide concurrency gate for archived-frame PNG decodes (sharp/libvips).
//
// WHY: the worker runs ONE BullMQ queue at WORKER_CONCURRENCY (default 10), so up
// to 10 decode-heavy jobs (cityWeather, areaWeather, weatherPanels) can run at
// once — and libvips itself fans each decode across every core. Peak native
// threads is therefore ~concurrency × cores, and glibc gives each thread its own
// malloc arena whose freed memory is never returned to the OS. Over a day of
// thousands of decodes that ratchets RSS up with no ceiling (the observed creep).
//
// This is the in-process counterpart of `nomadsGate` (politeness.ts): instead of
// splitting the single queue into a second BullMQ lane, we serialize the actual
// sharp work here so no more than SHARP_DECODE_CONCURRENCY decodes run at once,
// regardless of how many jobs BullMQ is draining. Bakes go through a separate
// worker-thread path (grib/bakeWorker.ts) and are intentionally NOT gated here,
// so live frame baking keeps its full-speed default concurrency.

/** Max concurrent frame decodes process-wide. Low by design — these are
 *  background precompute jobs, so serializing them costs nothing user-facing but
 *  caps the libvips thread/arena fan-out that drives RSS. Override via env. */
function decodeConcurrency(): number {
  const v = Number(process.env.SHARP_DECODE_CONCURRENCY);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 2;
}

let active = 0;
const waiters: Array<() => void> = [];

/** Acquire a decode slot, resolving once one is free. */
function acquire(limit: number): Promise<void> {
  if (active < limit) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

/** Release a slot and hand it to the next waiter, if any. */
function release(): void {
  const next = waiters.shift();
  if (next) next();
  else active = Math.max(0, active - 1);
}

/**
 * Run `fn` under the decode gate — at most SHARP_DECODE_CONCURRENCY run at once.
 * The slot is always released (even if `fn` throws), so a failed decode never
 * wedges the gate.
 */
export async function withDecodeGate<T>(fn: () => Promise<T>): Promise<T> {
  await acquire(decodeConcurrency());
  try {
    return await fn();
  } finally {
    release();
  }
}

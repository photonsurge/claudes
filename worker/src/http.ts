/**
 * Shared HTTP manners for feed/media jobs.
 *
 * Two problems this exists to solve, both learned from the volcano media jobs:
 *
 *  - NO TIMEOUT. `fetch` waits forever by default. Third-party camera and
 *    observatory endpoints go dark without closing the connection, so a single
 *    dead URL could stall an entire job indefinitely — which is what let the
 *    repeatable schedules overlap and stack up in the first place.
 *  - NO CONCURRENCY. Fetching hundreds of images with `await` in a `for` loop
 *    makes wall-clock the SUM of every request, so the slowest handful of
 *    providers set the runtime of the whole job.
 */

/** Generous enough for a slow observatory, short enough to never wedge a job. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * `fetch` that always gives up eventually. Everything else is passed straight
 * through, so this is a drop-in replacement.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(url, {
    ...rest,
    // Respect a caller's own signal (job shutdown) as well as the timeout.
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

/** A `fetch`-shaped function with a timeout baked in, for adapters that take a `fetchImpl`. */
export const timeoutFetch = (timeoutMs = DEFAULT_TIMEOUT_MS): typeof fetch =>
  ((url: any, init?: any) => fetchWithTimeout(url, { ...init, timeoutMs })) as typeof fetch;

/**
 * Release an unread response's socket + buffered body NOW, instead of leaving
 * undici to hold them until GC (or a timeout signal) gets around to it. Call on
 * every branch that returns/throws without consuming `res.body` — a non-ok
 * status still has a body. Fire-and-forget by design: cancelling can't fail in
 * a way the caller should care about.
 */
export function discardBody(res: Response): void {
  res.body?.cancel().catch(() => {});
}

/**
 * Map over `items` with at most `limit` running at once, preserving input order.
 *
 * Deliberately modest limits: these are other people's servers, and the point is
 * to stop one slow provider setting the pace, not to flood anyone.
 *
 * `fn` should handle its own errors — a rejection propagates and abandons the
 * remaining work, which is rarely what a best-effort media sweep wants.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

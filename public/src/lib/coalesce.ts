// lib/coalesce.ts
// Share one in-flight async result among callers that ask for the same thing at
// the same time. Two independent subscribers to a heavy feed (e.g. the World
// Watch panel and the globe alerts overlay both pulling
// `/api/alerts?active=1&limit=5000`, and both re-firing on the same
// ALERTS_UPDATED socket beat) would otherwise each pay the full round-trip AND
// the JSON parse of thousands of big-geometry docs — concurrently. Keying the
// in-flight promise by request collapses that to one.
//
// In-flight ONLY (no resolved-value cache): a caller arriving after the shared
// promise settles starts a fresh request, so this never serves stale data — it
// only dedupes the simultaneous burst. The entry is dropped as soon as it
// settles, so nothing is retained between bursts (memory discipline — runs 24/7).

const inflight = new Map<string, Promise<unknown>>();

/** Run `fn` under `key`, or join the in-flight run already registered for it. */
export function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

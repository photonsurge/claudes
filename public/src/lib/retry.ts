/**
 * Retry-until-landed for the broadcast pages' cold starts. /watch runs
 * unattended inside OBS browser sources 24/7: a request lost to a deploy/
 * restart window must retry itself — nobody is there to hit refresh, and the
 * page otherwise sits on the loading screen until a human notices the stream
 * is a spinner. (The socket refetch handlers are different: they fail soft and
 * keep the last good value, because they already have data on screen.)
 */

/** Exponential backoff for 0-based `attempt`: base·2^attempt, capped at max. */
export function backoffDelayMs(attempt: number, baseMs = 2_000, maxMs = 30_000): number {
  return Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 20));
}

/**
 * Run `fn` until it resolves non-null, then hand the value to `onValue` once.
 * Retries on throw AND on null/undefined — fetchManifest resolves null on a
 * 5xx as well as on "no run published yet", and both mean "try again soon".
 * Returns a cancel function (useEffect cleanup); after cancel nothing fires.
 */
export function retryUntil<T>(
  fn: () => Promise<T | null | undefined>,
  onValue: (value: T) => void,
  opts?: { baseMs?: number; maxMs?: number },
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  (async () => {
    for (let attempt = 0; !cancelled; attempt++) {
      try {
        const v = await fn();
        if (cancelled) return;
        if (v != null) {
          onValue(v);
          return;
        }
      } catch {
        /* transient — back off and go again */
      }
      if (cancelled) return;
      await new Promise<void>((resolve) => {
        timer = setTimeout(resolve, backoffDelayMs(attempt, opts?.baseMs, opts?.maxMs));
      });
    }
  })();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}

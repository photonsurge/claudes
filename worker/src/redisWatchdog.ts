/**
 * Redis liveness watchdog for the worker process.
 *
 * A worker that can't reach Redis can do NOTHING — every job, schedule, lock and
 * cancel signal lives there. But nothing made it stop: on 2026-07-21 redis was
 * shut down at 09:00 and only came back at 12:28, and for those 3.5 hours the
 * worker sat there fully "up", processing nothing, emitting a reconnect error per
 * client per retry until the log rotation ate the day's history. Its Docker
 * healthcheck did go 503 (/healthz pings the queue), but with `restart: "no"`
 * nothing acts on that — an unhealthy container just lingers.
 *
 * So: after a SUSTAINED outage, exit non-zero. That is the same bargain
 * `restart: "no"` already makes — a failure should be visible and terminal, not a
 * zombie — and it degrades correctly if the service is ever put back on
 * `unless-stopped`, where it becomes a clean restart with Docker's backoff.
 *
 * The threshold is deliberately far longer than any redis container recreate
 * (a `compose up -d` blip is seconds), so a deploy never trips it.
 * Set REDIS_OUTAGE_EXIT_MS=0 to disable and go back to waiting forever.
 */
import { redisOutageSince } from "@photonsurge/shared/bull/bull";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "redis-watchdog";

const DEFAULT_EXIT_AFTER_MS = 5 * 60_000;
const CHECK_INTERVAL_MS = 30_000;

/**
 * Start polling for a sustained Redis outage. Returns a stop function (called on
 * shutdown so the timer can't hold the process open).
 */
export function startRedisWatchdog(onFatal: (ms: number) => void = () => process.exit(1)): () => void {
  const exitAfterMs = Number(process.env.REDIS_OUTAGE_EXIT_MS ?? DEFAULT_EXIT_AFTER_MS);
  if (!exitAfterMs) {
    log(TAG, "disabled (REDIS_OUTAGE_EXIT_MS=0) — a redis outage will hang the worker indefinitely");
    return () => {};
  }

  // Fires ONCE. The default onFatal exits, but an injected one may not — and a
  // watchdog that re-fires every 30s would just be a slower version of the log
  // storm it exists to end.
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    const since = redisOutageSince();
    if (since === null) return;
    const downMs = Date.now() - since;
    if (downMs < exitAfterMs) return;
    fired = true;
    log(TAG, `redis unreachable for ${Math.round(downMs / 1000)}s — exiting; the worker cannot process anything without it`);
    onFatal(downMs);
  }, CHECK_INTERVAL_MS);
  // Don't keep the event loop alive just for the watchdog.
  timer.unref?.();

  return () => clearInterval(timer);
}

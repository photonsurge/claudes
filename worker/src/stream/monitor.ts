/**
 * A tiny per-key interval registry for the streaming-runs monitors. Generic on
 * purpose (no domain logic) so it can't form an import cycle with lifecycle.ts.
 *
 * Each live run gets ONE self-scheduling monitor (see lifecycle.ts) that polls
 * OBS + YouTube and emits health. It runs in-process — the worker is a single
 * process (like the auto-director's in-process loop), so this map is authoritative
 * and there's no cross-process duplication. Restart-safety comes from the boot
 * reconciler re-starting monitors for still-live runs; auto-END, by contrast, is a
 * durable BullMQ delayed job so it survives a restart on its own.
 */
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "stream-monitor";

interface MonitorState {
  stopped: boolean;
  timer: NodeJS.Timeout | null;
}

const monitors = new Map<string, MonitorState>();

/** True when a monitor is already running for this key. */
export function hasMonitor(key: string): boolean {
  return monitors.has(key);
}

/**
 * Start a self-scheduling monitor for `key`. `tick` returns the delay (ms) until
 * the next tick, or a negative number to stop. No-op if one is already running.
 */
export function startMonitor(key: string, tick: () => Promise<number>, firstDelayMs = 500): void {
  if (monitors.has(key)) return;
  const state: MonitorState = { stopped: false, timer: null };
  monitors.set(key, state);

  const run = async () => {
    if (state.stopped) return;
    let next = 5000;
    try {
      next = await tick();
    } catch (err) {
      log(TAG, `tick error [${key}]`, String((err as Error)?.message ?? err));
    }
    if (state.stopped) return;
    if (next < 0) {
      stopMonitor(key);
      return;
    }
    state.timer = setTimeout(run, next);
  };

  state.timer = setTimeout(run, firstDelayMs);
}

/** Stop and forget the monitor for `key`. */
export function stopMonitor(key: string): void {
  const state = monitors.get(key);
  if (!state) return;
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  monitors.delete(key);
}

/** Stop every monitor (worker shutdown). */
export function stopAllMonitors(): void {
  for (const key of [...monitors.keys()]) stopMonitor(key);
}

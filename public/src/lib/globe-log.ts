/**
 * The `[globe] …` one-liners (which patches went live, what size each texture
 * decoded to) are written once, early, and a profiler attaching to a
 * long-running OBS browser source arrives hours later — CDP can subscribe to
 * FUTURE console messages but cannot read back the ones already printed, so
 * every line that matters had already scrolled past unseen
 * (docs/watch-perf-plan.md, round 34).
 *
 * So they go to a ring buffer on `window` as well as the console, in the same
 * spirit as `__godsDeck` and `__godsLabels`: `scripts/profile-watch.mjs` reads
 * it after sampling and prints it as its own report section, whenever it
 * attached.
 */
"use client";

export const GLOBE_LOG_MAX = 200;
type LogWindow = Window & { __godsLog?: string[] };

/** Print a `[globe]` line and keep it where the profiler can find it. */
export function godsLog(line: string): void {
  console.info(line);
  if (typeof window === "undefined") return;
  const w = window as LogWindow;
  const log = (w.__godsLog ??= []);
  log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  // Oldest-first: a day-long broadcast keeps the most recent lines, and the
  // startup lines are re-emitted on the next reload anyway.
  if (log.length > GLOBE_LOG_MAX) log.splice(0, log.length - GLOBE_LOG_MAX);
}

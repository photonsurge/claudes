// weather/debug.ts
// Opt-in verbose tracing for the weather ingest pipeline. A full GFS ingest
// touches ~750 downloads/bakes, so per-step logging is OFF by default (it would
// bury the real signal). Set WEATHER_DEBUG=1 (or true) to stream every download,
// extract and bake step to stdout while diagnosing a source/throttling issue.

import { log } from "@photonsurge/shared/utill/logger";

/** True when WEATHER_DEBUG is set to a truthy token. */
export function weatherDebugOn(): boolean {
  const v = process.env.WEATHER_DEBUG;
  return v === "1" || v === "true" || v === "yes";
}

/** Log `msg` (+ optional data) to stdout only when WEATHER_DEBUG is on. */
export function dbg(tag: string, msg: string, data?: unknown): void {
  if (weatherDebugOn()) log(tag, `[debug] ${msg}`, data ?? {});
}

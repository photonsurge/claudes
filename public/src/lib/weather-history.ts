// lib/weather-history.ts
// Pure, sharp-free helpers + type re-exports for the /api/weather/history routes.
//
// The frame DECODE + sampling that used to live here (frameToSampleable /
// buildHistorySeries / buildAreaHistorySeries via sharp) moved to the WORKER —
// public no longer decodes weather PNGs. The routes + focus composer read the
// sampled numbers from the worker (see lib/worker-sample.ts and
// worker/src/weather/sampleService.ts). What remains here is only what public
// still needs directly: frame-pick math, the series shapes, and time parsing.

export { pickFramesForPoint } from "@photonsurge/shared/weather/pick";
export type {
  HistoryPoint,
  HistorySeries,
  AreaHistoryPoint,
  AreaHistorySeries,
} from "@photonsurge/shared/weather/history-types";

/** Parse a from/to query param (ISO string or epoch ms); undefined when absent/bad. */
export function parseTimeParam(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const asNum = Number(raw);
  const d = Number.isFinite(asNum) && raw.trim() !== "" ? new Date(asNum) : new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

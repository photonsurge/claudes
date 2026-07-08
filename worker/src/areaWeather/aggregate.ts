// areaWeather/aggregate.ts
// Pure reduction from "a place's bbox/mask + this hour's decoded frames" to a
// report's stats + hazard flags — no IO, so it's directly unit-testable with
// fabricated frames (mirrors worker/src/summaries/aggregate.ts's split between
// pure aggregation and the DB-touching job handler).
import { areaStatsFrame, type FrameLike } from "@photonsurge/shared/weather/sample";
import { classifyForecastDay, type DayAggregate } from "@photonsurge/shared/weather/forecastHazard";
import type { iAreaVariableStats, iAreaHazardFlag } from "@photonsurge/shared/db/area-weather-report-model";

export interface VariableFrame {
  variable: string;
  units: string;
  frame: FrameLike;
}

/** Pixels sampled per place per variable — plenty for a stable mean/min/max
 *  without the polygon mask's per-pixel ray-cast dominating an hourly run
 *  across ~240 countries × several variables. */
const MAX_SAMPLES = 3_000;

/**
 * Reduce one place's bbox (+ optional real-boundary mask) against this hour's
 * frames into its area-weather stats and forecast-hazard flags. `mask` is
 * omitted for regions (bbox-only, per the Region catalog's design) and
 * provided for countries (real polygon boundary via geo/pointInPolygon).
 */
export function reportForPlace(
  bbox: [number, number, number, number],
  mask: ((lat: number, lng: number) => boolean) | null,
  frames: VariableFrame[],
): { stats: iAreaVariableStats[]; hazards: iAreaHazardFlag[] } {
  const stats: iAreaVariableStats[] = [];
  for (const vf of frames) {
    const s = areaStatsFrame(vf.frame, bbox, MAX_SAMPLES, mask ?? undefined);
    if (!s) continue;
    stats.push({ variable: vf.variable, units: vf.units, mean: s.mean, min: s.min, max: s.max, count: s.count });
  }
  const aggregates: DayAggregate[] = stats.map((s) => ({ variable: s.variable, min: s.min, max: s.max }));
  const hazards = classifyForecastDay(aggregates);
  return { stats, hazards };
}

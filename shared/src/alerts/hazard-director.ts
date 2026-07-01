/**
 * Per-hazard "map plan" for the auto-director (spec: director map choices).
 *
 * When the director frames a severe-weather alert (a `storm` segment) it should
 * read the story through the fields that actually explain THAT hazard, not one
 * fixed sequence. A heat warning wants to open on humidity (the heat-index
 * story) and dwell; a tornado wants CAPE→radar→gust and a snappier cut. This
 * table is the editorial control surface for that — one entry per HazardType.
 *
 * Pure + dependency-free (only the HazardType union) so both the worker (which
 * bakes the opening field + hold into the Segment) and the client
 * (useCutVariable, which rotates the maps) resolve the same plan.
 *
 * `cycle` values are scalar-raster variable ids (see shared/src/variables.ts):
 * temp · humidity · rain · storm (CAPE) · gust · cloud · snow · sst · wave.
 * cycle[0] is the field the shot OPENS on.
 */
import type { HazardType } from "./hazard";

export interface HazardMapPlan {
  /** Ordered weather fields to cycle through; cycle[0] is what the shot opens on. */
  cycle: string[];
  /** ms to hold each map before rotating to the next. */
  cycleMs: number;
  /** Hold-time multiplier vs the base segment hold (>1 lingers on slow hazards). */
  holdScale: number;
}

/** Base cadence when a hazard doesn't override it. */
export const DEFAULT_CYCLE_MS = 5500;

/**
 * Fallback plan for hazards without a bespoke entry (and the historical `storm`
 * behaviour): wind-driven severe-weather read — gust, precip core, instability,
 * then humidity.
 */
export const DEFAULT_STORM_PLAN: HazardMapPlan = {
  cycle: ["gust", "rain", "storm", "humidity"],
  cycleMs: DEFAULT_CYCLE_MS,
  holdScale: 1,
};

/**
 * Bespoke plans keyed by hazard. Only the fields worth editing are listed; the
 * resolver fills cycleMs/holdScale from the default. Geophysical hazards
 * (tsunami/volcano/landslide) intentionally have no weather plan — they fall
 * back to the default storm read.
 *
 * Timing intent: slow, thermal hazards (heat/drought/fog) get a longer per-map
 * dwell so the field is legible; fast, convective hazards (tornado/cyclone) cut
 * quicker and linger longer overall (holdScale) because they're the headline.
 */
const PLANS: Partial<Record<HazardType, Partial<HazardMapPlan>>> = {
  // Heat: open on humidity (heat-index context) then the temperature itself.
  heat: { cycle: ["humidity", "temp"], cycleMs: 6500 },
  cold: { cycle: ["temp", "snow", "gust"], cycleMs: 6000 },
  wind: { cycle: ["gust", "temp"], cycleMs: 5000 },
  tornado: { cycle: ["storm", "rain", "gust"], cycleMs: 4500, holdScale: 1.15 },
  thunderstorm: { cycle: ["storm", "rain", "gust"], cycleMs: 4500 },
  rain: { cycle: ["rain", "humidity", "storm"], cycleMs: 5500 },
  flood: { cycle: ["rain", "humidity"], cycleMs: 6000 },
  "snow-ice": { cycle: ["snow", "temp", "rain"], cycleMs: 6000 },
  fog: { cycle: ["humidity", "cloud"], cycleMs: 6500 },
  // Fire-weather triangle: heat, dryness (low humidity), wind.
  fire: { cycle: ["temp", "humidity", "gust"], cycleMs: 5500 },
  dust: { cycle: ["gust", "temp"], cycleMs: 5000 },
  air: { cycle: ["cloud", "humidity"], cycleMs: 6500 },
  coastal: { cycle: ["wave", "gust"], cycleMs: 5500 },
  marine: { cycle: ["wave", "gust"], cycleMs: 5500 },
  avalanche: { cycle: ["snow", "temp"], cycleMs: 6000 },
  cyclone: { cycle: ["gust", "rain", "storm", "humidity"], cycleMs: 4500, holdScale: 1.25 },
  drought: { cycle: ["temp", "humidity"], cycleMs: 7000 },
};

/** The resolved map plan for a hazard (never null — falls back to the storm read). */
export function hazardMapPlan(hazard: HazardType | undefined): HazardMapPlan {
  const p = hazard ? PLANS[hazard] : undefined;
  if (!p) return DEFAULT_STORM_PLAN;
  return {
    cycle: p.cycle?.length ? p.cycle : DEFAULT_STORM_PLAN.cycle,
    cycleMs: p.cycleMs ?? DEFAULT_CYCLE_MS,
    holdScale: p.holdScale ?? 1,
  };
}

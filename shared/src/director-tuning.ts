/**
 * Per-channel director tuning — the policy that used to be hard-coded constants
 * in worker/src/director (candidates.ts, loop.ts), shared/director-select.ts and
 * the client tour stepper (public/src/lib/director.ts).
 *
 * Four top-level DirectorConfig keys rather than one `tuning` object: each is
 * edited by a different admin card, and the scene-settings catalog requires a
 * top-level key to have exactly one owning card (catalog.test.ts). Every
 * default is the constant it replaced, verbatim — shipping this changes no
 * channel's behaviour until an operator saves a different number.
 *
 * See docs/director-programme-plan.md §3.1.
 */

/** How far apart consecutive shots must be, and what selection remembers. */
export interface DirectorRotation {
  /** Min great-circle distance (degrees) from recently-aired shot centres. */
  geoCooldownDeg: number;
  /** How many recent located centres the geo cooldown remembers. */
  recentCentersCap: number;
  /** How many recent areas each kind remembers and avoids revisiting. */
  areaMemoryCap: number;
}

/** How big the event pools are and how hard catalogued craft are boosted. */
export interface DirectorPools {
  /** Max severe-weather candidates kept after ranking. */
  alertPoolCap: number;
  /** Max severe-weather candidates per country (or coarse cell). */
  alertCountryCap: number;
  /** Score for a catalogued (notable) flight/ship. */
  notableBoost: number;
  /** Score for a VIP flight/ship. */
  vipBoost: number;
}

/** Tour lengths and round-up pacing. */
export interface DirectorTours {
  /** Max stops on a country tour (establishing shot + cities). */
  countryStops: number;
  /** Max countries an area tour visits. */
  regionStops: number;
  /** Max stops a round-up's hold is sized to cover. */
  roundupStops: number;
  /** Camera dwell per tour stop, seconds — country, area and round-up tours. */
  stopDwellS: number;
  /** Reading pace that sizes a round-up's narration hold. */
  roundupWordsPerMin: number;
  /** Narration-hold cap for a round-up with no stops to tour, seconds. */
  roundupMaxHoldS: number;
  /** Camera zoom on a volcano shot. */
  volcanoZoom: number;
}

/** Client-side dwell per step within a shot. */
export interface DirectorTempo {
  /** Per look on a global / ocean / quake map-type tour, seconds. */
  mapStepS: number;
  /** Per field on a country / area variable cycle, seconds. */
  varCycleS: number;
  /** Per level on an ocean depth cycle, seconds. */
  depthCycleS: number;
}

export const DEFAULT_DIRECTOR_ROTATION: DirectorRotation = {
  geoCooldownDeg: 25,
  recentCentersCap: 8,
  areaMemoryCap: 3,
};

export const DEFAULT_DIRECTOR_POOLS: DirectorPools = {
  alertPoolCap: 40,
  alertCountryCap: 3,
  notableBoost: 45,
  vipBoost: 80,
};

export const DEFAULT_DIRECTOR_TOURS: DirectorTours = {
  countryStops: 8,
  regionStops: 10,
  roundupStops: 6,
  stopDwellS: 40,
  roundupWordsPerMin: 170,
  roundupMaxHoldS: 60,
  volcanoZoom: 5,
};

export const DEFAULT_DIRECTOR_TEMPO: DirectorTempo = {
  mapStepS: 6,
  varCycleS: 5.5,
  depthCycleS: 2.5,
};

/** Inclusive [min, max] per field, and whether the value is a whole number. */
type Bounds<T> = { [K in keyof T]: [min: number, max: number, integer?: true] };

export const DIRECTOR_ROTATION_BOUNDS: Bounds<DirectorRotation> = {
  geoCooldownDeg: [0, 90],
  recentCentersCap: [1, 50, true],
  areaMemoryCap: [0, 20, true],
};

export const DIRECTOR_POOLS_BOUNDS: Bounds<DirectorPools> = {
  alertPoolCap: [1, 200, true],
  alertCountryCap: [1, 50, true],
  notableBoost: [0, 200],
  vipBoost: [0, 200],
};

export const DIRECTOR_TOURS_BOUNDS: Bounds<DirectorTours> = {
  countryStops: [1, 20, true],
  regionStops: [1, 20, true],
  roundupStops: [1, 20, true],
  stopDwellS: [5, 120],
  roundupWordsPerMin: [60, 400],
  roundupMaxHoldS: [10, 300],
  volcanoZoom: [2, 10],
};

export const DIRECTOR_TEMPO_BOUNDS: Bounds<DirectorTempo> = {
  mapStepS: [1, 120],
  varCycleS: [1, 120],
  depthCycleS: [1, 120],
};

/**
 * Merge an untrusted partial bucket onto a base: unknown keys dropped,
 * non-numbers ignored (that field keeps the base value), every number clamped
 * to its bounds and rounded where the field is a count.
 */
export function mergeTuningBucket<T extends object>(
  bounds: Bounds<T>,
  base: T,
  patch: unknown,
): T {
  const out = { ...base };
  if (!patch || typeof patch !== "object") return out;
  const src = patch as Record<string, unknown>;
  for (const key of Object.keys(bounds) as (keyof T & string)[]) {
    const v = src[key];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const [min, max, integer] = bounds[key];
    const clamped = Math.min(max, Math.max(min, v));
    (out as Record<string, number>)[key] = integer ? Math.round(clamped) : clamped;
  }
  return out;
}

/** The within-shot dwell numbers the worker stamps onto every Segment. */
export interface SegmentTempo {
  mapStepMs: number;
  varCycleMs: number;
  depthCycleMs: number;
  stopDwellMs: number;
}

export function segmentTempo(tempo: DirectorTempo, tours: DirectorTours): SegmentTempo {
  return {
    mapStepMs: Math.round(tempo.mapStepS * 1000),
    varCycleMs: Math.round(tempo.varCycleS * 1000),
    depthCycleMs: Math.round(tempo.depthCycleS * 1000),
    stopDwellMs: Math.round(tours.stopDwellS * 1000),
  };
}

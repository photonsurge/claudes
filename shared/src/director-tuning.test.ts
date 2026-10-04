import {
  DEFAULT_DIRECTOR_POOLS,
  DEFAULT_DIRECTOR_ROTATION,
  DEFAULT_DIRECTOR_TEMPO,
  DEFAULT_DIRECTOR_TOURS,
  DIRECTOR_POOLS_BOUNDS,
  DIRECTOR_ROTATION_BOUNDS,
  DIRECTOR_TOURS_BOUNDS,
  mergeTuningBucket,
  segmentTempo,
} from "./director-tuning";
import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig } from "./director";

describe("director tuning defaults", () => {
  // Pinned on purpose: these are the constants the director used before they
  // became per-channel settings. Changing one changes every channel that has
  // never saved its own value, so it must be a deliberate edit here too.
  it("equal the constants they replaced", () => {
    expect(DEFAULT_DIRECTOR_ROTATION).toEqual({ geoCooldownDeg: 25, recentCentersCap: 8, areaMemoryCap: 3 });
    expect(DEFAULT_DIRECTOR_POOLS).toEqual({ alertPoolCap: 40, alertCountryCap: 3, notableBoost: 45, vipBoost: 80 });
    expect(DEFAULT_DIRECTOR_TOURS).toEqual({
      countryStops: 8,
      regionStops: 10,
      roundupStops: 6,
      stopDwellS: 40,
      roundupWordsPerMin: 170,
      roundupMaxHoldS: 60,
      volcanoZoom: 5,
    });
    expect(DEFAULT_DIRECTOR_TEMPO).toEqual({ mapStepS: 6, varCycleS: 5.5, depthCycleS: 2.5 });
  });

  it("are the director config defaults", () => {
    expect(DEFAULT_DIRECTOR_CONFIG.rotation).toBe(DEFAULT_DIRECTOR_ROTATION);
    expect(DEFAULT_DIRECTOR_CONFIG.pools).toBe(DEFAULT_DIRECTOR_POOLS);
    expect(DEFAULT_DIRECTOR_CONFIG.tours).toBe(DEFAULT_DIRECTOR_TOURS);
    expect(DEFAULT_DIRECTOR_CONFIG.tempo).toBe(DEFAULT_DIRECTOR_TEMPO);
  });
});

describe("mergeTuningBucket", () => {
  it("keeps the base for missing, non-numeric and non-finite values", () => {
    const out = mergeTuningBucket(DIRECTOR_POOLS_BOUNDS, DEFAULT_DIRECTOR_POOLS, {
      alertPoolCap: "50",
      alertCountryCap: NaN,
      vipBoost: Infinity,
    });
    expect(out).toEqual(DEFAULT_DIRECTOR_POOLS);
  });

  it("clamps to bounds and rounds counts", () => {
    const out = mergeTuningBucket(DIRECTOR_ROTATION_BOUNDS, DEFAULT_DIRECTOR_ROTATION, {
      geoCooldownDeg: 400,
      recentCentersCap: 4.6,
      areaMemoryCap: -2,
    });
    expect(out).toEqual({ geoCooldownDeg: 90, recentCentersCap: 5, areaMemoryCap: 0 });
  });

  it("drops unknown keys and ignores a non-object patch", () => {
    const out = mergeTuningBucket(DIRECTOR_TOURS_BOUNDS, DEFAULT_DIRECTOR_TOURS, { bogus: 3, countryStops: 4 });
    expect(out).toEqual({ ...DEFAULT_DIRECTOR_TOURS, countryStops: 4 });
    expect("bogus" in out).toBe(false);
    expect(mergeTuningBucket(DIRECTOR_TOURS_BOUNDS, DEFAULT_DIRECTOR_TOURS, "nope")).toEqual(DEFAULT_DIRECTOR_TOURS);
  });
});

describe("mergeDirectorConfig tuning buckets", () => {
  it("merges each bucket per field", () => {
    const out = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, {
      pools: { alertPoolCap: 20 } as any,
      tempo: { mapStepS: 10 } as any,
    });
    expect(out.pools).toEqual({ ...DEFAULT_DIRECTOR_POOLS, alertPoolCap: 20 });
    expect(out.tempo).toEqual({ ...DEFAULT_DIRECTOR_TEMPO, mapStepS: 10 });
    expect(out.rotation).toEqual(DEFAULT_DIRECTOR_ROTATION);
    expect(out.tours).toEqual(DEFAULT_DIRECTOR_TOURS);
  });

  it("fills the buckets from defaults for a config stored before they existed", () => {
    const { rotation, pools, tours, tempo, breakIn, ...legacy } = DEFAULT_DIRECTOR_CONFIG;
    const out = mergeDirectorConfig(legacy as any, {});
    expect(out.rotation).toEqual(rotation);
    expect(out.pools).toEqual(pools);
    expect(out.tours).toEqual(tours);
    expect(out.tempo).toEqual(tempo);
    expect(out.breakIn.enabled).toBe(breakIn.enabled);
  });
});

describe("segmentTempo", () => {
  it("converts the dwell seconds to whole milliseconds", () => {
    expect(segmentTempo(DEFAULT_DIRECTOR_TEMPO, DEFAULT_DIRECTOR_TOURS)).toEqual({
      mapStepMs: 6000,
      varCycleMs: 5500,
      depthCycleMs: 2500,
      stopDwellMs: 40000,
    });
  });
});

import {
  DEFAULT_DIRECTOR_CONFIG,
  INITIAL_DIRECTOR_STATE,
  mergeDirectorConfig,
  DIRECTOR_STATE,
  SEGMENT_KINDS,
  type DirectorConfig,
} from "./director";

describe("director event + defaults", () => {
  it("uses the agreed wire name", () => {
    expect(DIRECTOR_STATE).toBe("director:state");
  });

  it("starts off and idle", () => {
    expect(DEFAULT_DIRECTOR_CONFIG.mode).toBe("off");
    expect(INITIAL_DIRECTOR_STATE.active).toBe(false);
    expect(INITIAL_DIRECTOR_STATE.segment).toBeNull();
  });

  it("has a flag for every segment kind", () => {
    for (const k of SEGMENT_KINDS) {
      expect(typeof DEFAULT_DIRECTOR_CONFIG.kinds[k]).toBe("boolean");
    }
  });
});

describe("mergeDirectorConfig", () => {
  const base: DirectorConfig = DEFAULT_DIRECTOR_CONFIG;

  it("returns base on empty patch", () => {
    expect(mergeDirectorConfig(base, {})).toEqual(base);
  });

  it("applies a partial kinds patch without dropping the others", () => {
    const merged = mergeDirectorConfig(base, { kinds: { ship: false } as any });
    expect(merged.kinds.ship).toBe(false);
    expect(merged.kinds.quake).toBe(true); // untouched
  });

  it("validates mode and clamps holdSeconds to a sane floor", () => {
    expect(mergeDirectorConfig(base, { mode: "bogus" as any }).mode).toBe("off");
    expect(mergeDirectorConfig(base, { mode: "auto" }).mode).toBe("auto");
    expect(mergeDirectorConfig(base, { holdSeconds: 1 }).holdSeconds).toBe(3);
  });

  it("ignores non-numeric thresholds", () => {
    const merged = mergeDirectorConfig(base, { minQuakeMag: "big" as any });
    expect(merged.minQuakeMag).toBe(base.minQuakeMag);
  });

  it("carries a skip bump through", () => {
    expect(mergeDirectorConfig(base, { skipNonce: 7 }).skipNonce).toBe(7);
  });
});

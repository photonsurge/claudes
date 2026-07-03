import {
  DEFAULT_DIRECTOR_CONFIG,
  INITIAL_DIRECTOR_STATE,
  mergeDirectorConfig,
  DIRECTOR_STATE,
  SEGMENT_KINDS,
  STORM_LEVELS,
  QUAKE_LEVELS,
  stormLevelForRank,
  kindHoldMs,
  quakeHoldMs,
  stormHoldMs,
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

  it("has a hold duration for every segment kind, quake level and storm level", () => {
    for (const k of SEGMENT_KINDS) {
      expect(DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds[k]).toBeGreaterThan(0);
    }
    for (const cls of QUAKE_LEVELS) {
      expect(DEFAULT_DIRECTOR_CONFIG.quakeHoldSeconds[cls]).toBeGreaterThan(0);
    }
    for (const l of STORM_LEVELS) {
      expect(DEFAULT_DIRECTOR_CONFIG.stormHoldSeconds[l.key]).toBeGreaterThan(0);
    }
  });

  it("holds the world spins longer than a plain tour (the old ×1.4 intent)", () => {
    const d = DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds;
    expect(d.intro).toBeGreaterThan(d.tour);
    expect(d.ocean).toBeGreaterThan(d.tour);
    expect(d.orbital).toBeGreaterThan(d.tour);
  });

  it("dwells longer the bigger the event", () => {
    const q = DEFAULT_DIRECTOR_CONFIG.quakeHoldSeconds;
    expect(q.great).toBeGreaterThan(q.major);
    expect(q.major).toBeGreaterThan(q.strong);
    expect(q.strong).toBeGreaterThan(q.moderate);
    const s = DEFAULT_DIRECTOR_CONFIG.stormHoldSeconds;
    expect(s.extreme).toBeGreaterThan(s.severe);
    expect(s.severe).toBeGreaterThan(s.moderate);
  });
});

describe("stormLevelForRank", () => {
  it("maps each normalised severityRank onto its named level", () => {
    expect(stormLevelForRank(4)).toBe("extreme");
    expect(stormLevelForRank(3)).toBe("severe");
    expect(stormLevelForRank(2)).toBe("moderate");
    expect(stormLevelForRank(1)).toBe("minor");
    expect(stormLevelForRank(0)).toBe("info");
    expect(stormLevelForRank(-1)).toBe("info"); // defensive floor
    expect(stormLevelForRank(9)).toBe("extreme"); // defensive ceiling
  });
});

describe("hold resolvers", () => {
  const cfg = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, {
    kindHoldSeconds: { tour: 20 } as DirectorConfig["kindHoldSeconds"],
    quakeHoldSeconds: { great: 45 } as DirectorConfig["quakeHoldSeconds"],
    stormHoldSeconds: { extreme: 33 } as DirectorConfig["stormHoldSeconds"],
  });

  it("resolves a kind hold in ms", () => {
    expect(kindHoldMs(cfg, "tour")).toBe(20_000);
    expect(kindHoldMs(cfg, "ship")).toBe(12_000); // untouched default
  });

  it("resolves a quake hold from the magnitude class", () => {
    expect(quakeHoldMs(cfg, 8.2)).toBe(45_000); // great — operator-tuned
    expect(quakeHoldMs(cfg, 6.4)).toBe(16_000); // strong — default
  });

  it("resolves a storm hold from the severity rank", () => {
    expect(stormHoldMs(cfg, 4)).toBe(33_000); // extreme — operator-tuned
    expect(stormHoldMs(cfg, 3)).toBe(16_000); // severe — default
  });

  it("survives a config missing the hold maps (pre-upgrade Mongo doc)", () => {
    const legacy = { ...DEFAULT_DIRECTOR_CONFIG } as DirectorConfig & Record<string, unknown>;
    delete (legacy as Record<string, unknown>).kindHoldSeconds;
    delete (legacy as Record<string, unknown>).quakeHoldSeconds;
    delete (legacy as Record<string, unknown>).stormHoldSeconds;
    expect(kindHoldMs(legacy, "tour")).toBe(12_000);
    expect(quakeHoldMs(legacy, 8.2)).toBe(30_000);
    expect(stormHoldMs(legacy, 4)).toBe(24_000);
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

  it("validates mode", () => {
    expect(mergeDirectorConfig(base, { mode: "bogus" as any }).mode).toBe("off");
    expect(mergeDirectorConfig(base, { mode: "auto" }).mode).toBe("auto");
  });

  it("applies partial hold-map patches without dropping siblings, clamped to the 3s floor", () => {
    const merged = mergeDirectorConfig(base, {
      kindHoldSeconds: { tour: 1 } as any, // below the floor
      quakeHoldSeconds: { great: 45 } as any,
      stormHoldSeconds: { extreme: 33, moderate: "x" } as any, // non-number ignored
    });
    expect(merged.kindHoldSeconds.tour).toBe(3); // clamped
    expect(merged.kindHoldSeconds.intro).toBe(base.kindHoldSeconds.intro); // untouched
    expect(merged.quakeHoldSeconds.great).toBe(45);
    expect(merged.quakeHoldSeconds.strong).toBe(base.quakeHoldSeconds.strong);
    expect(merged.stormHoldSeconds.extreme).toBe(33);
    expect(merged.stormHoldSeconds.moderate).toBe(base.stormHoldSeconds.moderate);
  });

  it("ignores non-numeric thresholds", () => {
    const merged = mergeDirectorConfig(base, { minQuakeMag: "big" as any });
    expect(merged.minQuakeMag).toBe(base.minQuakeMag);
  });

  it("carries a skip bump through", () => {
    expect(mergeDirectorConfig(base, { skipNonce: 7 }).skipNonce).toBe(7);
  });

  it("ships the ad kind off by default", () => {
    expect(SEGMENT_KINDS).toContain("ad");
    expect(DEFAULT_DIRECTOR_CONFIG.kinds.ad).toBe(false);
  });

  it("ships the country kind on by default with UK + Japan favourited", () => {
    expect(SEGMENT_KINDS).toContain("country");
    expect(DEFAULT_DIRECTOR_CONFIG.kinds.country).toBe(true);
    expect(DEFAULT_DIRECTOR_CONFIG.countries).toEqual(["uk", "japan"]);
  });

  it("sanitizes a countries patch to known catalog ids and keeps base otherwise", () => {
    expect(mergeDirectorConfig(base, { countries: ["japan", "atlantis"] }).countries).toEqual(["japan"]);
    expect(mergeDirectorConfig(base, { countries: [] }).countries).toEqual([]);
    expect(mergeDirectorConfig(base, { countries: "uk" as any }).countries).toEqual(base.countries);
    expect(mergeDirectorConfig(base, {}).countries).toEqual(base.countries);
  });

  it("clamps the ad cadence to a floor of 1 and rounds it", () => {
    expect(mergeDirectorConfig(base, { adEveryNShots: 0 }).adEveryNShots).toBe(1);
    expect(mergeDirectorConfig(base, { adEveryNShots: -3 }).adEveryNShots).toBe(1);
    expect(mergeDirectorConfig(base, { adEveryNShots: 5.6 }).adEveryNShots).toBe(6);
    expect(mergeDirectorConfig(base, { adEveryNShots: "x" as any }).adEveryNShots).toBe(base.adEveryNShots);
  });
});

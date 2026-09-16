import {
  DEFAULT_DIRECTOR_CONFIG,
  DEFAULT_KIND_SLIDES,
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
  upNextLabel,
  type DirectorConfig,
  focusSubjectOf,
  splitAlertSubject,
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

  it("keeps magnetic-field options out of seeded seismic slides", () => {
    const slides = DEFAULT_KIND_SLIDES.quake ?? [];
    expect(slides.length).toBeGreaterThan(0);
    expect(slides.some((slide) => slide.overlays.showMagneticField)).toBe(false);
    expect(slides.some((slide) => /magnetic/i.test(`${slide.id} ${slide.name}`))).toBe(false);
  });

  it("seeds the newer land weather fields and keeps event context on geology weather slides", () => {
    for (const kind of ["intro", "global", "country", "region"] as const) {
      const variables = (DEFAULT_KIND_SLIDES[kind] ?? []).map((slide) => slide.look.activeVariable);
      expect(variables).toEqual(expect.arrayContaining(["feelslike", "pwat", "uvindex"]));
    }

    const orbitalUv = DEFAULT_KIND_SLIDES.orbital?.find((slide) => slide.look.activeVariable === "uvindex");
    expect(orbitalUv?.overlays).toMatchObject({ showSatellites: true, showOrbits: true });

    for (const kind of ["quake", "volcano"] as const) {
      const marker = kind === "quake" ? "showSeismic" : "showVolcanoes";
      const weather = (DEFAULT_KIND_SLIDES[kind] ?? []).filter((slide) =>
        ["temp", "rain", "cloud"].includes(slide.look.activeVariable ?? ""),
      );
      expect(weather.map((slide) => slide.look.activeVariable)).toEqual(["temp", "rain", "cloud"]);
      for (const slide of weather) expect(slide.overlays[marker]).toBe(true);
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

  it("holds the world spins longer than a framed shot (the old ×1.4 intent)", () => {
    const d = DEFAULT_DIRECTOR_CONFIG.kindHoldSeconds;
    expect(d.intro).toBeGreaterThan(d.country);
    expect(d.ocean).toBeGreaterThan(d.country);
    expect(d.orbital).toBeGreaterThan(d.country);
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
    kindHoldSeconds: { country: 20 } as DirectorConfig["kindHoldSeconds"],
    quakeHoldSeconds: { great: 45 } as DirectorConfig["quakeHoldSeconds"],
    stormHoldSeconds: { extreme: 33 } as DirectorConfig["stormHoldSeconds"],
  });

  it("resolves a kind hold in ms", () => {
    expect(kindHoldMs(cfg, "country")).toBe(20_000);
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
    expect(kindHoldMs(legacy, "country")).toBe(12_000);
    expect(quakeHoldMs(legacy, 8.2)).toBe(30_000);
    expect(stormHoldMs(legacy, 4)).toBe(24_000);
  });
});

describe("upNextLabel", () => {
  it("carries the locating subtitle so the rail says where, not just what", () => {
    expect(upNextLabel({ kind: "quake", title: "Earthquake", subtitle: "M5.6 · Southern Sumatra" })).toBe(
      "Earthquake — M5.6 · Southern Sumatra",
    );
  });

  it("degrades to the bare title when a segment has no subtitle", () => {
    expect(upNextLabel({ kind: "global", title: "World View" })).toBe("World View");
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

  it("sanitizes a regions favourites patch (known ids only; non-array keeps base)", () => {
    expect(mergeDirectorConfig(base, { regions: ["europe", "atlantis"] }).regions).toEqual(["europe"]);
    // A non-array patch is ignored — the base favourites survive.
    expect(mergeDirectorConfig(base, { regions: "europe" as any }).regions).toEqual(base.regions);
  });

  it("applies partial hold-map patches without dropping siblings, clamped to the 3s floor", () => {
    const merged = mergeDirectorConfig(base, {
      kindHoldSeconds: { country: 1 } as any, // below the floor
      quakeHoldSeconds: { great: 45 } as any,
      stormHoldSeconds: { extreme: 33, moderate: "x" } as any, // non-number ignored
    });
    expect(merged.kindHoldSeconds.country).toBe(3); // clamped
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

  it("has no standalone summary kind — round-ups ride the global spin", () => {
    expect(SEGMENT_KINDS).not.toContain("summary" as never);
    expect(SEGMENT_KINDS).toContain("global");
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

  it("sanitizes kindWeights: clamps to 0.1–10, drops unknown kinds, elides ×1 back to sparse", () => {
    const merged = mergeDirectorConfig(base, {
      kindWeights: { country: 50, ship: 0.01, storm: 2, bogus: 3, quake: "x" } as any,
    });
    expect(merged.kindWeights).toEqual({ country: 10, ship: 0.1, storm: 2 });
    // Setting a kind back to 1 removes it from the sparse map.
    expect(mergeDirectorConfig(merged, { kindWeights: { storm: 1 } }).kindWeights).toEqual({
      country: 10,
      ship: 0.1,
    });
    // Absent patch keeps the base map.
    expect(mergeDirectorConfig(merged, {}).kindWeights).toEqual(merged.kindWeights);
  });

  it("clamps the ad cadence to a floor of 1 and rounds it", () => {
    expect(mergeDirectorConfig(base, { adEveryNShots: 0 }).adEveryNShots).toBe(1);
    expect(mergeDirectorConfig(base, { adEveryNShots: -3 }).adEveryNShots).toBe(1);
    expect(mergeDirectorConfig(base, { adEveryNShots: 5.6 }).adEveryNShots).toBe(6);
    expect(mergeDirectorConfig(base, { adEveryNShots: "x" as any }).adEveryNShots).toBe(base.adEveryNShots);
  });

  it("merges mapTypes per kind, dropping non-string-array values and unknown kinds", () => {
    const merged = mergeDirectorConfig(base, {
      mapTypes: { quake: ["relief", "night"], bogus: ["x"], intro: "not-an-array" } as any,
    });
    expect(merged.mapTypes.quake).toEqual(["relief", "night"]);
    expect(merged.mapTypes.intro).toBeUndefined();
    expect((merged.mapTypes as any).bogus).toBeUndefined();
    // A second patch only touching `intro` doesn't drop the earlier `quake` entry.
    const merged2 = mergeDirectorConfig(merged, { mapTypes: { intro: ["temp"] } });
    expect(merged2.mapTypes.quake).toEqual(["relief", "night"]);
    expect(merged2.mapTypes.intro).toEqual(["temp"]);
  });

  it("merges overlayOverrides per kind, keeping only boolean leaves and not dropping sibling keys", () => {
    const merged = mergeDirectorConfig(base, {
      overlayOverrides: { quake: { showFaults: false, showCities: "yes" as any } },
    });
    expect(merged.overlayOverrides.quake).toEqual({ showFaults: false });
    // A follow-up single-key patch merges into the same kind's map, not replacing it.
    const merged2 = mergeDirectorConfig(merged, { overlayOverrides: { quake: { showCables: false } } });
    expect(merged2.overlayOverrides.quake).toEqual({ showFaults: false, showCables: false });
  });

  it("merges kindLooks per kind — basemap and wind fields independently, siblings preserved", () => {
    const merged = mergeDirectorConfig(base, {
      kindLooks: { storm: { basemap: "night", wind: { speedFactor: 16, color: "#cfe8ff" } } },
    });
    expect(merged.kindLooks.storm).toEqual({
      basemap: "night",
      wind: { speedFactor: 16, color: "#cfe8ff" },
    });

    // A follow-up patch touching only one wind field doesn't wipe the others or the basemap.
    const merged2 = mergeDirectorConfig(merged, {
      kindLooks: { storm: { wind: { numParticles: 9000 } } },
    });
    expect(merged2.kindLooks.storm).toEqual({
      basemap: "night",
      wind: { speedFactor: 16, color: "#cfe8ff", numParticles: 9000 },
    });

    // Non-boolean-typed junk on wind numeric keys is ignored; unknown kinds dropped.
    const merged3 = mergeDirectorConfig(merged2, {
      kindLooks: {
        storm: { wind: { speedFactor: "fast" as any } },
        atlantis: { basemap: "dark" },
      } as any,
    });
    expect(merged3.kindLooks.storm?.wind?.speedFactor).toBe(16);
    expect((merged3.kindLooks as any).atlantis).toBeUndefined();
  });

  it("clears kindLooks fields with an explicit null, leaving siblings alone", () => {
    const merged = mergeDirectorConfig(base, {
      kindLooks: { storm: { basemap: "night", showSatImg: true, wind: { speedFactor: 16 } } },
    });
    const cleared = mergeDirectorConfig(merged, { kindLooks: { storm: { wind: null } } });
    expect(cleared.kindLooks.storm).toEqual({ basemap: "night", showSatImg: true });

    const clearedAll = mergeDirectorConfig(cleared, {
      kindLooks: { storm: { basemap: null, showSatImg: null } },
    });
    expect(clearedAll.kindLooks.storm).toEqual({ basemap: undefined, showSatImg: undefined });
  });

  it("merges a kindLooks satellite look/on-off, validates the look, and clears with null", () => {
    const merged = mergeDirectorConfig(base, {
      kindLooks: { storm: { showSatImg: true, satImgLook: "watervapour" } },
    });
    expect(merged.kindLooks.storm?.showSatImg).toBe(true);
    expect(merged.kindLooks.storm?.satImgLook).toBe("watervapour");
    // An unknown look is rejected (→ undefined), not stored.
    const bad = mergeDirectorConfig(merged, { kindLooks: { storm: { satImgLook: "bogus" as never } } });
    expect(bad.kindLooks.storm?.satImgLook).toBeUndefined();
    expect(bad.kindLooks.storm?.showSatImg).toBe(true); // sibling untouched
    // Explicit null clears back to inherit.
    const cleared = mergeDirectorConfig(merged, { kindLooks: { storm: { showSatImg: null } } });
    expect(cleared.kindLooks.storm?.showSatImg).toBeUndefined();
    expect(cleared.kindLooks.storm?.satImgLook).toBe("watervapour");
  });

  it("merges a kindLooks activeVariable override, ignoring non-strings, and clears with null", () => {
    const merged = mergeDirectorConfig(base, {
      kindLooks: { storm: { activeVariable: "gust" } },
    });
    expect(merged.kindLooks.storm?.activeVariable).toBe("gust");

    const rejected = mergeDirectorConfig(merged, { kindLooks: { storm: { activeVariable: 7 as never } } });
    expect(rejected.kindLooks.storm?.activeVariable).toBeUndefined();

    const cleared = mergeDirectorConfig(merged, { kindLooks: { storm: { activeVariable: null } } });
    expect(cleared.kindLooks.storm?.activeVariable).toBeUndefined();
  });

  it("merges a kindLooks satImgFeeds patch, dropping unknown feed ids and invalid fields", () => {
    const merged = mergeDirectorConfig(base, {
      kindLooks: {
        storm: {
          satImgFeeds: {
            "goes-east": { on: true, opacity: 0.6, look: "geocolor" },
            bogus: { on: true, opacity: 1 },
            himawari: { opacity: "x" as any, on: "y" as any },
          },
        },
      } as any,
    });
    expect(merged.kindLooks.storm?.satImgFeeds).toEqual({
      "goes-east": { on: true, opacity: 0.6, look: "geocolor" },
      himawari: {},
    });

    const cleared = mergeDirectorConfig(merged, { kindLooks: { storm: { satImgFeeds: null } } });
    expect(cleared.kindLooks.storm?.satImgFeeds).toBeUndefined();
  });

  it("merges kindLooks auroraOpacity/magneticFieldOpacity, ignoring non-numbers, and clears with null", () => {
    const merged = mergeDirectorConfig(base, {
      kindLooks: { storm: { auroraOpacity: 0.4, magneticFieldOpacity: 0.6 } },
    });
    expect(merged.kindLooks.storm?.auroraOpacity).toBe(0.4);
    expect(merged.kindLooks.storm?.magneticFieldOpacity).toBe(0.6);

    const rejected = mergeDirectorConfig(merged, {
      kindLooks: { storm: { auroraOpacity: "x" as never } },
    });
    expect(rejected.kindLooks.storm?.auroraOpacity).toBeUndefined();
    expect(rejected.kindLooks.storm?.magneticFieldOpacity).toBe(0.6);

    const cleared = mergeDirectorConfig(merged, {
      kindLooks: { storm: { auroraOpacity: null, magneticFieldOpacity: null } },
    });
    expect(cleared.kindLooks.storm?.auroraOpacity).toBeUndefined();
    expect(cleared.kindLooks.storm?.magneticFieldOpacity).toBeUndefined();
  });

  it("merges kindSlides per kind, sanitizing each slide's look/overlays and dropping malformed entries", () => {
    const merged = mergeDirectorConfig(base, {
      kindSlides: {
        storm: [
          {
            id: "a",
            name: "Cinematic",
            look: { basemap: "night", wind: { speedFactor: 20, color: 123 as any } },
            overlays: { showFaults: false, showCities: "yes" as any },
          },
          { id: "b" } as any, // missing name — dropped
        ],
        atlantis: [{ id: "c", name: "x", look: {}, overlays: {} }],
      } as any,
    });
    expect(merged.kindSlides.storm).toEqual([
      {
        id: "a",
        name: "Cinematic",
        look: { basemap: "night", wind: { speedFactor: 20 } },
        overlays: { showFaults: false },
      },
    ]);
    expect((merged.kindSlides as any).atlantis).toBeUndefined();

    // Replaces the kind's list wholesale (not merged item-by-item) — a
    // save/delete round trip sends the kind's full intended list.
    const merged2 = mergeDirectorConfig(merged, { kindSlides: { storm: [] } });
    expect(merged2.kindSlides.storm).toEqual([]);
  });

  it("merges activeSlideId per kind, keeping only strings, and clears with null", () => {
    const merged = mergeDirectorConfig(base, { activeSlideId: { storm: "a", quake: 5 as any } });
    expect(merged.activeSlideId.storm).toBe("a");
    expect(merged.activeSlideId.quake).toBeUndefined();

    const cleared = mergeDirectorConfig(merged, { activeSlideId: { storm: null } });
    expect(cleared.activeSlideId.storm).toBeUndefined();

    // Untouched kinds/keys survive a follow-up patch.
    const merged2 = mergeDirectorConfig(merged, { activeSlideId: { quake: "q1" } });
    expect(merged2.activeSlideId.storm).toBe("a");
    expect(merged2.activeSlideId.quake).toBe("q1");
  });
});

describe("focusSubjectOf / splitAlertSubject", () => {
  it("keeps everything after the kind — subjects carry colons of their own", () => {
    expect(focusSubjectOf("quake:us7000abcd")).toBe("us7000abcd");
    expect(focusSubjectOf("volcano:gvp:211060")).toBe("gvp:211060");
    expect(focusSubjectOf("storm:meteoalarm:2.49.0.0.376.0.IL.x")).toBe("meteoalarm:2.49.0.0.376.0.IL.x");
    expect(focusSubjectOf("global")).toBeNull();
    expect(focusSubjectOf("intro:")).toBeNull();
  });

  it("splits a storm subject back into its alert key, and null for a bare id", () => {
    expect(splitAlertSubject("meteoalarm:2.49.0.0.376.0.IL.x")).toEqual({
      source: "meteoalarm",
      identifier: "2.49.0.0.376.0.IL.x",
    });
    expect(splitAlertSubject("wmo:by-belhydromet-en/2026/09/16:1")).toEqual({
      source: "wmo",
      identifier: "by-belhydromet-en/2026/09/16:1",
    });
    expect(splitAlertSubject("us7000abcd")).toBeNull();
  });
});

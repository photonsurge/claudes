import {
  quakeMapPlan,
  QUAKE_TSUNAMI_PLAN,
  QUAKE_LAND_PLAN,
  globalMapTour,
  INTRO_MAP_TYPES,
  OCEAN_MAP_TYPES,
  QUAKE_MAP_TYPES,
  ORBITAL_VIEWS,
  ORBITAL_VIEW_ZOOM,
  orbitalViewZoom,
  orbitalZoomForShell,
  PRESETS,
} from "./director-rois";

describe("quakeMapPlan", () => {
  it("reads the ocean story (sst → wave) for a tsunami-flagged quake", () => {
    expect(quakeMapPlan(true)).toBe(QUAKE_TSUNAMI_PLAN);
    expect(quakeMapPlan(true).cycle[0]).toBe("sst");
  });

  it("reads a neutral temp/sst backdrop for an ordinary quake", () => {
    expect(quakeMapPlan(false)).toBe(QUAKE_LAND_PLAN);
    expect(quakeMapPlan(undefined)).toBe(QUAKE_LAND_PLAN);
    expect(quakeMapPlan().cycle[0]).toBe("temp");
  });

  it("never shows meteorological fields over a quake", () => {
    const meteo = new Set(["humidity", "rain", "gust", "storm"]);
    for (const plan of [QUAKE_TSUNAMI_PLAN, QUAKE_LAND_PLAN]) {
      for (const v of plan.cycle) expect(meteo.has(v)).toBe(false);
    }
  });
});

describe("globalMapTour", () => {
  it("tours the intro spin (opening on temperature) and the ocean spin (opening on SST)", () => {
    expect(globalMapTour("intro")).toBe(INTRO_MAP_TYPES);
    // The recurring global spin shares the intro opener's exact tour.
    expect(globalMapTour("global")).toBe(INTRO_MAP_TYPES);
    expect(globalMapTour("ocean")).toBe(OCEAN_MAP_TYPES);
    expect(INTRO_MAP_TYPES[0].id).toBe("temp"); // hero field leads
    expect(OCEAN_MAP_TYPES[0].id).toBe("sst");
  });

  it("doesn't tour kinds that hold a field or run a curated plan", () => {
    for (const kind of ["country", "storm", "flight", "ship", "orbital"] as const) {
      expect(globalMapTour(kind)).toBeNull();
    }
  });

  it("tours geophysical terrain looks for a quake (opening on elevation contours)", () => {
    const tour = globalMapTour("quake");
    expect(tour).toBe(QUAKE_MAP_TYPES);
    expect(tour![0].id).toBe("contours"); // hero look matches the quake preset
    // No weather field on any quake look — a quake reads as terrain, not forecast.
    for (const t of QUAKE_MAP_TYPES) expect(t.patch.activeVariable ?? null).toBeNull();
    // The alternates actually swap the base map (relief fill, night city lights).
    // No satellite imagery — real-world orbital imagery over an epicentre reads
    // as a stock photo, not a geophysical instrument view.
    expect(QUAKE_MAP_TYPES.map((t) => t.patch.basemap)).toEqual(
      expect.arrayContaining(["relief", "night"]),
    );
    expect(QUAKE_MAP_TYPES.map((t) => t.patch.basemap)).not.toContain("satellite");
  });

  it("filters the tour to operator-enabled ids, falling back to the full catalog if the filter is empty or all-unmatched", () => {
    expect(globalMapTour("quake", ["relief", "night"])!.map((t) => t.id)).toEqual(["relief", "night"]);
    expect(globalMapTour("quake", [])).toBe(QUAKE_MAP_TYPES);
    expect(globalMapTour("quake", undefined)).toBe(QUAKE_MAP_TYPES);
    expect(globalMapTour("quake", ["nonexistent-id"])).toBe(QUAKE_MAP_TYPES);
  });

  it("includes the new 'map types' (aurora, satellite imagery) gated on live data", () => {
    const aurora = INTRO_MAP_TYPES.find((t) => t.id === "aurora");
    const satimg = INTRO_MAP_TYPES.find((t) => t.id === "satimg");
    expect(aurora?.needs).toEqual({ kind: "aurora" });
    expect(satimg?.needs).toEqual({ kind: "satimg" });
    // The overlay looks drop the scalar field so the glow / imagery reads cleanly.
    expect(aurora?.patch.activeVariable).toBeNull();
    expect(aurora?.patch.showAurora).toBe(true);
    expect(satimg?.patch.showSatImg).toBe(true);
  });

  it("tours Earth at Night on the intro spin, ungated (static local asset)", () => {
    const night = INTRO_MAP_TYPES.find((t) => t.id === "night");
    expect(night?.patch.basemap).toBe("night");
    // No scalar field or chrome — the city lights are the look.
    expect(night?.patch.activeVariable).toBeNull();
    expect(night?.patch.showWind).toBe(false);
    // Always available (baked into /data), so no live-data gate.
    expect(night?.needs).toBeUndefined();
  });

  it("asserts the map-type overlays OFF in the director's clean base so looks don't stick", () => {
    // Every non-aurora/satimg step relies on the preset base resetting these.
    expect(PRESETS.intro.showAurora).toBe(false);
    expect(PRESETS.intro.showSatImg).toBe(false);
    expect(PRESETS.global.showAurora).toBe(false);
    expect(PRESETS.global.showSatImg).toBe(false);
    expect(PRESETS.ocean.showAurora).toBe(false);
  });
});

describe("orbital framing", () => {
  // Apparent width of a shell, in pixels of the 1920x1080 broadcast frame, from
  // deck's globe projection: radius = (alt/R + 1) · 256 · 2^zoom / (π · cos lat).
  const shellWidthPx = (altKm: number, zoom: number, lat = 20) =>
    (2 * ((altKm * 1000) / 6370972 + 1) * 256 * Math.pow(2, zoom)) / (Math.PI * Math.cos((lat * Math.PI) / 180));

  it("frames a geostationary belt inside the frame width", () => {
    const zoom = orbitalZoomForShell(35786);
    expect(shellWidthPx(35786, zoom)).toBeLessThanOrEqual(1920);
    // ...and uses most of it, rather than shrinking the planet for nothing.
    expect(shellWidthPx(35786, zoom)).toBeGreaterThan(0.7 * 1920);
  });

  it("frames an inclined shell against the frame's SHORT side, since it stands as tall as it is wide", () => {
    const zoom = orbitalZoomForShell(20200, 55);
    expect(shellWidthPx(20200, zoom)).toBeLessThanOrEqual(1080);
  });

  it("pulls back further for a higher shell", () => {
    expect(orbitalZoomForShell(35786)).toBeLessThan(orbitalZoomForShell(20200));
    expect(orbitalZoomForShell(20200)).toBeLessThan(orbitalZoomForShell(850));
  });

  it("pulls back further for a more inclined shell at the same altitude", () => {
    expect(orbitalZoomForShell(20200, 55)).toBeLessThan(orbitalZoomForShell(20200, 0));
  });

  it("takes the shell framing over a hand-set zoom, and falls back to the default", () => {
    expect(orbitalViewZoom({ group: "g", title: "t", subtitle: "s", shellKm: 35786, zoom: 3 })).toBeCloseTo(
      orbitalZoomForShell(35786),
      6,
    );
    expect(orbitalViewZoom({ group: "g", title: "t", subtitle: "s", zoom: 2.2 })).toBe(2.2);
    expect(orbitalViewZoom({ group: "g", title: "t", subtitle: "s" })).toBe(ORBITAL_VIEW_ZOOM);
  });

  it("keeps every medium/high constellation's ring inside the broadcast frame", () => {
    // The regression: these were framed by eye for the planet, which left a
    // geostationary ring 2,150px across a 1,920px frame — mostly off screen.
    for (const view of ORBITAL_VIEWS.filter((v) => v.shellKm !== undefined)) {
      const zoom = orbitalViewZoom(view);
      const width = shellWidthPx(view.shellKm as number, zoom);
      expect(width).toBeLessThanOrEqual(1920);
      if ((view.inclDeg ?? 0) > 20) expect(width).toBeLessThanOrEqual(1080);
    }
  });

  it("leaves the hand-tuned low-Earth framings alone", () => {
    const leo = ORBITAL_VIEWS.filter((v) => v.shellKm === undefined);
    expect(leo.map((v) => v.group)).toContain("starlink");
    for (const v of leo) expect(orbitalViewZoom(v)).toBe(v.zoom);
  });
});

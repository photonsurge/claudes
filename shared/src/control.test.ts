import {
  DEFAULT_CONTROL_STATE,
  DEFAULT_BASEMAP_COLORS,
  mergeControlState,
  CONTROL_STATE,
  WEATHER_RUN,
  ControlState,
} from "./control";

describe("DEFAULT_CONTROL_STATE", () => {
  it("is a sensible starting state", () => {
    expect(DEFAULT_CONTROL_STATE.fhr).toBe(0);
    expect(DEFAULT_CONTROL_STATE.showWind).toBe(true);
    expect(DEFAULT_CONTROL_STATE.camera.center).toHaveLength(2);
    expect(["kt", "m/s"]).toContain(DEFAULT_CONTROL_STATE.units.wind);
  });
});

describe("event name constants", () => {
  it("match the agreed wire names", () => {
    expect(CONTROL_STATE).toBe("control:state");
    expect(WEATHER_RUN).toBe("weather:run");
  });
});

describe("mergeControlState", () => {
  const base: ControlState = DEFAULT_CONTROL_STATE;

  it("keeps base values when patch is empty", () => {
    expect(mergeControlState(base, {})).toEqual(base);
  });

  // Guards the control→/watch sync: every ControlState field must round-trip
  // through the merge, or it would be silently dropped on the player.
  it("carries EVERY field through (no field silently dropped)", () => {
    const custom: ControlState = {
      activeVariable: "rain",
      fhr: 9,
      basemap: "satellite",
      showWind: false,
      showPressure: true,
      showCities: false,
      camera: { center: [10, 20], zoom: 5 },
      units: { wind: "m/s", temp: "F" },
      basemapColors: { ocean: "#111111", land: "#222222", border: "#333333" },
      wind: { numParticles: 1234, speedFactor: 3, maxAge: 7, width: 5, opacity: 0.5, color: "#abcdef" },
      windMode: "barbs",
      showContours: true,
      showRadar: true,
      showSatellites: true,
      showAircraft: true,
      showShips: true,
      satelliteGroup: "starlink",
      autoSpin: true,
      spinSpeed: 17,
      spinEpoch: 123456789,
      showTrackLabels: true,
      aircraftStyle: { color: "altitude", icon: "glyph" },
      shipStyle: { color: "speed", icon: "dot" },
      showOrbits: true,
      showTrails: true,
      trailMinutes: 60,
      trailOpacity: 0.5,
      showAlerts: true,
      alertSeverityMin: 3,
      showSeismic: true,
      seismicMinMag: 4.5,
    };
    // Deep-equal proves no key was dropped or altered by the merge.
    expect(mergeControlState(DEFAULT_CONTROL_STATE, custom)).toEqual(custom);
    expect(Object.keys(mergeControlState(DEFAULT_CONTROL_STATE, custom)).sort()).toEqual(
      Object.keys(DEFAULT_CONTROL_STATE).sort(),
    );
  });

  it("overrides scalar fields", () => {
    const next = mergeControlState(base, { fhr: 12, basemap: "satellite", showWind: false });
    expect(next.fhr).toBe(12);
    expect(next.basemap).toBe("satellite");
    expect(next.showWind).toBe(false);
    expect(next.showPressure).toBe(base.showPressure);
  });

  it("allows activeVariable to be set to null but not clobbered by undefined", () => {
    expect(mergeControlState(base, { activeVariable: null }).activeVariable).toBeNull();
    expect(mergeControlState(base, {}).activeVariable).toBe(base.activeVariable);
  });

  it("merges camera and units partially", () => {
    const next = mergeControlState(base, { camera: { center: [10, 50], zoom: 3 } });
    expect(next.camera).toEqual({ center: [10, 50], zoom: 3 });
    const u = mergeControlState(base, { units: { temp: "F" } as any });
    expect(u.units.temp).toBe("F");
    expect(u.units.wind).toBe(base.units.wind);
  });

  it("ignores a malformed camera center", () => {
    const next = mergeControlState(base, { camera: { center: [1] as any, zoom: 2 } });
    expect(next.camera.center).toEqual(base.camera.center);
    expect(next.camera.zoom).toBe(2);
  });

  it("defaults basemapColors and merges them partially", () => {
    expect(base.basemapColors).toEqual(DEFAULT_BASEMAP_COLORS);
    const next = mergeControlState(base, { basemapColors: { land: "#123456" } as any });
    expect(next.basemapColors.land).toBe("#123456");
    expect(next.basemapColors.ocean).toBe(base.basemapColors.ocean);
    expect(next.basemapColors.border).toBe(base.basemapColors.border);
  });

  it("backfills basemapColors when the base state predates the field", () => {
    const legacy = { ...DEFAULT_CONTROL_STATE, basemapColors: undefined as any };
    const next = mergeControlState(legacy, {});
    expect(next.basemapColors).toEqual(DEFAULT_BASEMAP_COLORS);
  });
});

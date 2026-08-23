import {
  DEFAULT_CONTROL_STATE,
  DEFAULT_BASEMAP_COLORS,
  DEFAULT_AUDIO_SETTINGS,
  mergeControlState,
  CONTROL_STATE,
  WEATHER_RUN,
  ControlState,
  slugifySceneId,
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
      showElevation: true,
      elevation: { colorMode: "custom", color: "#00ff00", width: 2, opacity: 0.8, interval: 500, majorInterval: 2000 },
      showRadar: true,
      showSatellites: true,
      showAircraft: true,
      showShips: true,
      satelliteGroup: "starlink",
      autoSpin: true,
      spinSpeed: 17,
      zoomDrift: 0,
      orbitDrift: 4,
      idleMotion: true,
      idleOrbit: 5,
      idleBreathe: 0.4,
      idlePeriodS: 45,
      spinEpoch: 123456789,
      cutTransitionMs: 4200,
      showTrackLabels: true,
      satelliteStyle: { color: "custom", icon: "dot", customColor: "#00ffaa", opacity: 0.8, minAltM: 0, maxAltM: 2000000, minSpeed: 0, country: "", hideGround: false },
      aircraftStyle: { color: "altitude", icon: "glyph", customColor: "#facc15", opacity: 0.5, minAltM: 3000, maxAltM: 0, minSpeed: 50, country: "United States", hideGround: true },
      shipStyle: { color: "speed", icon: "dot", customColor: "#22c55e", opacity: 1, minAltM: 0, maxAltM: 0, minSpeed: 2, country: "", hideGround: false },
      showOrbits: true,
      showTrails: true,
      trailMinutes: 60,
      trailOpacity: 0.5,
      showAlerts: true,
      alertSeverityMin: 3,
      alertHazardsOff: ["marine", "fog"],
      alertCycle: false,
      showSeismic: true,
      seismicMinMag: 4.5,
      showCables: true,
      showCableLabels: true,
      showFaults: true,
      showAurora: true,
      auroraOpacity: 0.6,
      showSatImg: true,
      satImgFeeds: {
        global: { on: true, opacity: 0.7 },
        "goes-east": { on: false, opacity: 0.9, look: "geocolor" },
        "goes-west": { on: true, opacity: 0.5, look: "dust" },
        himawari: { on: true, opacity: 0.8, look: "airmass" },
        "meteosat-0": { on: true, opacity: 0.6, look: "watervapour" },
        "meteosat-iodc": { on: false, opacity: 0.9, look: "ir" },
        lightning: { on: true, opacity: 0.95 },
      },
      showFires: true,
      showVolcanoes: true,
      showMagneticField: true,
      magneticFieldOpacity: 0.4,
      showGraticule: true,
      graticuleColor: "#abcdef",
      graticuleLabels: false,
      showAtmosphere: false,
      showDayNight: true,
      showBroadcastChrome: true,
      broadcastTheme: "command",
      widgetsOff: ["seismic", "syslog"],
      slidesOff: ["depth", "volcano-geology"],
      slideOrder: ["forecast", "topcities"],
      slideHoldMs: 12000,
      reportOff: ["hourly", "alerts"],
      reportOrder: ["seismic", "volcanoes"],
      reportKindsOff: ["alert"],
      reportHazardsOff: ["fire", "fog"],
      pointVarsOff: ["humidity", "pressure"],
      themeOverrides: {
        name: "ATLANTIC WIND",
        accent: "#00d0ff",
        titleColor: "#ffffff",
        tickerBg: "linear-gradient(#000, #111)",
      },
      showMapSource: true,
      about: {
        title: "About Atlantic Wind",
        body: "First paragraph.\n\nSecond paragraph.",
        sources: "NOAA GFS, USGS, GDACS",
        footer: "Custom small print.",
      },
      audio: { enabled: true, mode: "deep", volume: 0.45, muted: true },
      chat: { enabled: true, promoteToTicker: true },
      startAt: 1732000000000,
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

  it("sanitises themeOverrides to known string keys", () => {
    const next = mergeControlState(base, {
      themeOverrides: {
        titleColor: "#123456",
        bogus: "x",
        textColor: 7,
      } as never,
    });
    // Known string keys pass; unknown keys and non-strings are dropped.
    expect(next.themeOverrides).toEqual({ titleColor: "#123456" });
  });

  it("merges about partially, dropping non-string values", () => {
    const next = mergeControlState(base, {
      about: { sources: "NOAA GFS, USGS", title: 7 } as never,
    });
    // The set string lands, the non-string is ignored, siblings keep base values.
    expect(next.about.sources).toBe("NOAA GFS, USGS");
    expect(next.about.title).toBe(base.about.title);
    expect(next.about.body).toBe(base.about.body);
    // Missing from the patch → keeps the base value.
    expect(mergeControlState(next, {}).about.sources).toBe("NOAA GFS, USGS");
  });

  it("sanitises alertHazardsOff to known hazard types and dedupes", () => {
    const next = mergeControlState(base, {
      alertHazardsOff: ["fog", "bogus", "fog", "marine"] as never,
    });
    expect(next.alertHazardsOff).toEqual(["fog", "marine"]);
    // Missing from the patch → keeps the base value.
    expect(mergeControlState(next, {}).alertHazardsOff).toEqual(["fog", "marine"]);
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

  it("merges audio partially, keeping untouched fields", () => {
    const next = mergeControlState(base, { audio: { muted: true } as any });
    expect(next.audio.muted).toBe(true);
    expect(next.audio.mode).toBe(base.audio.mode);
    expect(next.audio.volume).toBe(base.audio.volume);
  });

  it("rejects an unknown audio mode and clamps volume", () => {
    const next = mergeControlState(base, { audio: { mode: "dubstep", volume: 4 } as any });
    expect(next.audio.mode).toBe(DEFAULT_AUDIO_SETTINGS.mode);
    expect(next.audio.volume).toBe(1);
  });

  it("backfills audio when the base state predates the field", () => {
    const legacy = { ...DEFAULT_CONTROL_STATE, audio: undefined as any };
    const next = mergeControlState(legacy, {});
    expect(next.audio).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("merges chat partially and backfills when the base predates the field", () => {
    const next = mergeControlState(base, { chat: { enabled: true } as any });
    expect(next.chat.enabled).toBe(true);
    expect(next.chat.promoteToTicker).toBe(base.chat.promoteToTicker);
    const legacy = { ...DEFAULT_CONTROL_STATE, chat: undefined as any };
    expect(mergeControlState(legacy, {}).chat).toEqual({ enabled: false, promoteToTicker: false });
  });

  it("clamps idle-motion amounts and backfills when the base predates them", () => {
    const next = mergeControlState(base, { idleOrbit: 999, idleBreathe: -1, idlePeriodS: 2 } as never);
    expect(next.idleOrbit).toBe(30);
    expect(next.idleBreathe).toBe(0);
    expect(next.idlePeriodS).toBe(10);
    const legacy = {
      ...DEFAULT_CONTROL_STATE,
      idleMotion: undefined,
      idleOrbit: undefined,
      idleBreathe: undefined,
      idlePeriodS: undefined,
    } as never as ControlState;
    const filled = mergeControlState(legacy, {});
    expect(filled.idleMotion).toBe(false);
    expect(filled.idleOrbit).toBe(DEFAULT_CONTROL_STATE.idleOrbit);
    expect(filled.idleBreathe).toBe(DEFAULT_CONTROL_STATE.idleBreathe);
    expect(filled.idlePeriodS).toBe(DEFAULT_CONTROL_STATE.idlePeriodS);
  });

  it("sets, clears, and preserves the pre-broadcast countdown target", () => {
    expect(base.startAt).toBeNull();
    const started = mergeControlState(base, { startAt: 1732000000000 });
    expect(started.startAt).toBe(1732000000000);
    expect(mergeControlState(started, {}).startAt).toBe(1732000000000);
    expect(mergeControlState(started, { startAt: null }).startAt).toBeNull();
  });
});

describe("slugifySceneId", () => {
  it("lowercases and dashes free text into a url-safe id", () => {
    expect(slugifySceneId("Atlantic Wind")).toBe("atlantic-wind");
    expect(slugifySceneId("  North_Pole / Temp!! ")).toBe("north-pole-temp");
  });

  it("collapses runs of separators and trims edge dashes", () => {
    expect(slugifySceneId("--a   b---c--")).toBe("a-b-c");
  });

  it("returns empty string when there is nothing usable", () => {
    expect(slugifySceneId("***")).toBe("");
    expect(slugifySceneId("")).toBe("");
  });
});

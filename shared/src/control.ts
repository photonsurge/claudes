/**
 * Realtime control contract shared by the socket server, the /control operator
 * page, and the /watch broadcast page.
 *
 * /control is the source of truth: on change it emits CONTROL_STATE over the
 * socket (instant live update) and persists the same shape to Mongo via
 * /api/broadcast/state (durable cold-start). /watch loads the persisted state on
 * mount then live-updates from CONTROL_STATE.
 */

/** Socket event names (also the worker→browser weather event). */
export const CONTROL_STATE = "control:state" as const;
export const WEATHER_RUN = "weather:run" as const;
export const CITIES_UPDATED = "cities:updated" as const;
/** Worker → browser: a new aircraft/ship snapshot frame was recorded. */
export const TRACKS_UPDATED = "tracks:updated" as const;

export type WindUnit = "kt" | "m/s";
export type TempUnit = "C" | "F";

export interface ControlCamera {
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
}

/** Operator-chosen colours for the dark (vector) basemap. Hex strings. */
export interface BasemapColors {
  /** Ocean / sphere background fill. */
  ocean: string;
  /** Land fill. */
  land: string;
  /** Country/coastline stroke. */
  border: string;
}

export const DEFAULT_BASEMAP_COLORS: BasemapColors = {
  ocean: "#080e18",
  land: "#1c222e",
  border: "#dce4f0",
};

/** Tunable wind ParticleLayer look. */
export interface WindSettings {
  numParticles: number;
  speedFactor: number;
  /** Trail length in frames (higher = longer streaks). */
  maxAge: number;
  width: number;
  /** Layer opacity 0..1. Live-adjustable without restarting the particles. */
  opacity: number;
  /** Particle colour as a hex string (`#rrggbb`). Live-adjustable. */
  color: string;
}

export const DEFAULT_WIND_SETTINGS: WindSettings = {
  numParticles: 6000,
  speedFactor: 8,
  maxAge: 30,
  width: 2,
  opacity: 0.9,
  color: "#ffffff",
};

/** Named looks for quick on-air changes. */
export const WIND_PRESETS: Record<string, WindSettings> = {
  calm: { numParticles: 3000, speedFactor: 4, maxAge: 45, width: 1.5, opacity: 0.9, color: "#ffffff" },
  default: { ...DEFAULT_WIND_SETTINGS },
  dense: { numParticles: 12000, speedFactor: 8, maxAge: 25, width: 1.4, opacity: 0.9, color: "#ffffff" },
  storm: { numParticles: 9000, speedFactor: 16, maxAge: 16, width: 2.5, opacity: 1, color: "#cfe8ff" },
};

/** How the wind field is drawn. */
export type WindMode = "particles" | "barbs";

/**
 * The full operator state rendered by /watch. Kept intentionally flat and
 * JSON-serialisable so it round-trips cleanly over the socket and through Mongo.
 */
export interface ControlState {
  /** Active scalar variable id (temp/humidity/rain/storm/gust), or null. */
  activeVariable: string | null;
  /** Active forecast hour (matches a run step `fhr`). */
  fhr: number;
  /** Basemap id from the BASEMAPS registry. */
  basemap: string;
  /** Wind particle layer toggle. */
  showWind: boolean;
  /** Pressure contour + H/L layer toggle. */
  showPressure: boolean;
  /** Render city markers/labels. */
  showCities: boolean;
  camera: ControlCamera;
  units: { wind: WindUnit; temp: TempUnit };
  /** Colours for the dark (vector) basemap. Raster basemaps ignore these. */
  basemapColors: BasemapColors;
  /** Wind particle appearance. */
  wind: WindSettings;
  /** Draw wind as flowing particles or meteorological barbs. */
  windMode: WindMode;
  /** Isolines for the active scalar variable. */
  showContours: boolean;
  /** Live RainViewer radar overlay. */
  showRadar: boolean;
  /** Overlay live satellite positions (SGP4, client-side). */
  showSatellites: boolean;
  /** Overlay live aircraft (ADS-B via OpenSky). */
  showAircraft: boolean;
  /** Overlay live ships (AIS via aisstream). */
  showShips: boolean;
  /** Celestrak group for the satellite overlay. */
  satelliteGroup: string;
  /** Auto-rotate the globe (broadcast idle spin). */
  autoSpin: boolean;
  /** Spin speed in degrees per second. */
  spinSpeed: number;
  /**
   * Wall-clock ms when the current spin anchor was set. Both /control and /watch
   * compute longitude = camera.center[0] + spinSpeed*(now-spinEpoch)/1000, so
   * they rotate in phase from the same anchor with no per-frame socket traffic.
   */
  spinEpoch: number;
  /** Show name labels on the live-track overlay (decluttered). */
  showTrackLabels: boolean;
  /** Draw satellite orbit rings (one period each). */
  showOrbits: boolean;
  /** Draw recent trailing routes behind aircraft/ships (from recorded history). */
  showTrails: boolean;
  /** Trail length in minutes of recorded history. */
  trailMinutes: number;
  /** Trail line opacity (0–1). Low by default so dense traffic stays readable. */
  trailOpacity: number;
  /** Overlay active weather-alert areas (polygons) on the globe. */
  showAlerts: boolean;
  /** Only show alerts at/above this severityRank (0–4). */
  alertSeverityMin: number;
  /** Overlay recent earthquakes (USGS) on the globe. */
  showSeismic: boolean;
  /** Only show quakes at/above this magnitude. */
  seismicMinMag: number;
}

export const DEFAULT_CONTROL_STATE: ControlState = {
  activeVariable: "temp",
  fhr: 0,
  basemap: "dark",
  showWind: true,
  showPressure: false,
  showCities: true,
  camera: { center: [0, 20], zoom: 2.5 },
  units: { wind: "kt", temp: "C" },
  basemapColors: { ...DEFAULT_BASEMAP_COLORS },
  wind: { ...DEFAULT_WIND_SETTINGS },
  windMode: "particles",
  showContours: false,
  showRadar: false,
  showSatellites: false,
  showAircraft: false,
  showShips: false,
  satelliteGroup: "visual",
  autoSpin: false,
  spinSpeed: 8,
  spinEpoch: 0,
  showTrackLabels: false,
  showOrbits: false,
  showTrails: false,
  trailMinutes: 30,
  trailOpacity: 0.35,
  showAlerts: false,
  alertSeverityMin: 0,
  showSeismic: false,
  seismicMinMag: 2.5,
};

/**
 * Merge a partial (possibly untrusted, from socket/HTTP) control patch onto a
 * base state, keeping unknown/missing fields at their previous value. Pure —
 * used by both client and server, and unit-tested.
 */
export function mergeControlState(base: ControlState, patch: Partial<ControlState>): ControlState {
  return {
    activeVariable:
      patch.activeVariable === undefined ? base.activeVariable : patch.activeVariable,
    fhr: typeof patch.fhr === "number" ? patch.fhr : base.fhr,
    basemap: typeof patch.basemap === "string" ? patch.basemap : base.basemap,
    showWind: typeof patch.showWind === "boolean" ? patch.showWind : base.showWind,
    showPressure:
      typeof patch.showPressure === "boolean" ? patch.showPressure : base.showPressure,
    showCities: typeof patch.showCities === "boolean" ? patch.showCities : base.showCities,
    camera: patch.camera
      ? {
          center:
            Array.isArray(patch.camera.center) && patch.camera.center.length === 2
              ? [Number(patch.camera.center[0]), Number(patch.camera.center[1])]
              : base.camera.center,
          zoom: typeof patch.camera.zoom === "number" ? patch.camera.zoom : base.camera.zoom,
        }
      : base.camera,
    units: {
      wind: patch.units?.wind ?? base.units.wind,
      temp: patch.units?.temp ?? base.units.temp,
    },
    basemapColors: {
      ocean: patch.basemapColors?.ocean ?? base.basemapColors?.ocean ?? DEFAULT_BASEMAP_COLORS.ocean,
      land: patch.basemapColors?.land ?? base.basemapColors?.land ?? DEFAULT_BASEMAP_COLORS.land,
      border:
        patch.basemapColors?.border ?? base.basemapColors?.border ?? DEFAULT_BASEMAP_COLORS.border,
    },
    wind: {
      numParticles:
        patch.wind?.numParticles ?? base.wind?.numParticles ?? DEFAULT_WIND_SETTINGS.numParticles,
      speedFactor:
        patch.wind?.speedFactor ?? base.wind?.speedFactor ?? DEFAULT_WIND_SETTINGS.speedFactor,
      maxAge: patch.wind?.maxAge ?? base.wind?.maxAge ?? DEFAULT_WIND_SETTINGS.maxAge,
      width: patch.wind?.width ?? base.wind?.width ?? DEFAULT_WIND_SETTINGS.width,
      opacity: patch.wind?.opacity ?? base.wind?.opacity ?? DEFAULT_WIND_SETTINGS.opacity,
      color: patch.wind?.color ?? base.wind?.color ?? DEFAULT_WIND_SETTINGS.color,
    },
    windMode: patch.windMode ?? base.windMode ?? "particles",
    showContours:
      typeof patch.showContours === "boolean" ? patch.showContours : base.showContours ?? false,
    showRadar: typeof patch.showRadar === "boolean" ? patch.showRadar : base.showRadar ?? false,
    showSatellites:
      typeof patch.showSatellites === "boolean" ? patch.showSatellites : base.showSatellites ?? false,
    showAircraft:
      typeof patch.showAircraft === "boolean" ? patch.showAircraft : base.showAircraft ?? false,
    showShips: typeof patch.showShips === "boolean" ? patch.showShips : base.showShips ?? false,
    satelliteGroup: patch.satelliteGroup ?? base.satelliteGroup ?? "visual",
    autoSpin: typeof patch.autoSpin === "boolean" ? patch.autoSpin : base.autoSpin ?? false,
    spinSpeed: typeof patch.spinSpeed === "number" ? patch.spinSpeed : base.spinSpeed ?? 8,
    spinEpoch: typeof patch.spinEpoch === "number" ? patch.spinEpoch : base.spinEpoch ?? 0,
    showTrackLabels:
      typeof patch.showTrackLabels === "boolean"
        ? patch.showTrackLabels
        : base.showTrackLabels ?? false,
    showOrbits: typeof patch.showOrbits === "boolean" ? patch.showOrbits : base.showOrbits ?? false,
    showTrails: typeof patch.showTrails === "boolean" ? patch.showTrails : base.showTrails ?? false,
    trailMinutes:
      typeof patch.trailMinutes === "number" ? patch.trailMinutes : base.trailMinutes ?? 30,
    trailOpacity:
      typeof patch.trailOpacity === "number" ? patch.trailOpacity : base.trailOpacity ?? 0.35,
    showAlerts: typeof patch.showAlerts === "boolean" ? patch.showAlerts : base.showAlerts ?? false,
    alertSeverityMin:
      typeof patch.alertSeverityMin === "number"
        ? patch.alertSeverityMin
        : base.alertSeverityMin ?? 0,
    showSeismic: typeof patch.showSeismic === "boolean" ? patch.showSeismic : base.showSeismic ?? false,
    seismicMinMag:
      typeof patch.seismicMinMag === "number" ? patch.seismicMinMag : base.seismicMinMag ?? 2.5,
  };
}

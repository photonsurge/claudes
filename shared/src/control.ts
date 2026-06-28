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

export type WindUnit = "kt" | "m/s";
export type TempUnit = "C" | "F";

export interface ControlCamera {
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
}

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
}

export const DEFAULT_CONTROL_STATE: ControlState = {
  activeVariable: "temp",
  fhr: 0,
  basemap: "dark",
  showWind: true,
  showPressure: false,
  showCities: true,
  camera: { center: [0, 20], zoom: 1.4 },
  units: { wind: "kt", temp: "C" },
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
  };
}

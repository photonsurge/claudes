/**
 * Realtime control contract shared by the socket server, the /control operator
 * page, and the /watch broadcast page.
 *
 * /control is the source of truth: on change it emits CONTROL_STATE over the
 * socket (instant live update) and persists the same shape to Mongo via
 * /api/broadcast/state (durable cold-start). /watch loads the persisted state on
 * mount then live-updates from CONTROL_STATE.
 */

import {
  DEFAULT_SATIMG_FEEDS,
  defaultSatImgFeeds,
  isSatImgLook,
  type SatImgFeedState,
} from "./satimg/types";
import { isHazardType, type HazardType } from "./alerts/hazard";

/** Socket event names (also the worker→browser weather event). */
export const CONTROL_STATE = "control:state" as const;
export const WEATHER_RUN = "weather:run" as const;
export const CITIES_UPDATED = "cities:updated" as const;
/** Worker → browser: a new aircraft/ship/seismic snapshot frame was recorded. */
export const TRACKS_UPDATED = "tracks:updated" as const;
/** Worker → browser: an alerts ingest tick finished (overlay should refetch). */
export const ALERTS_UPDATED = "alerts:updated" as const;
/** Worker → browser: a new weather-event round-up was generated (admin refetch). */
export const SUMMARIES_UPDATED = "summaries:updated" as const;

/**
 * Operator → watchers relay for a *named scene*. `CONTROL_STATE` drives the one
 * legacy `/watch`; `SCENE_STATE` carries an `{ id, state }` envelope so multiple
 * `/watch/:id` pages (OBS sources / overlay windows) each follow their own scene.
 */
export const SCENE_STATE = "scene:state" as const;

/** Id of the singleton "main" broadcast — the scene `/watch` (no id) renders. */
export const MAIN_SCENE_ID = "default" as const;

/** Socket envelope for a scene-scoped control update. */
export interface SceneStatePayload {
  /** Scene id this update targets (matches a scene doc id). */
  id: string;
  /** The full control state for that scene. */
  state: ControlState;
}

/** Scene list-item metadata (no full ControlState) for admin/selector lists. */
export interface SceneMeta {
  id: string;
  /** Operator-facing display name. */
  name: string;
  /** ISO update time, if known. */
  updatedAt?: string;
  /** Secret gating this scene's /watch URL. Admin-only — omitted from public listings. */
  watchToken?: string;
}

/**
 * Normalise a free-text scene name into a url/id-safe slug: lowercase, ascii
 * alphanumerics + single dashes, no leading/trailing dash. Returns "" if the
 * input has no usable characters (caller should reject empty).
 */
export function slugifySceneId(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

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
 * How the generative audio bed on /watch picks its section. "auto" follows the
 * broadcast (on-air segment severity + the engine's slow drift); the named modes
 * pin the arrangement to one section regardless of what's on air.
 */
export type AudioMode = "auto" | "chill" | "lounge" | "deep" | "minimal" | "breaks";
export const AUDIO_MODES: AudioMode[] = ["auto", "chill", "lounge", "deep", "minimal", "breaks"];

/**
 * Operator settings for the generative music bed. Set on /control, played by
 * every /watch (the bed synthesizes client-side, so this is settings-only —
 * no audio travels over the socket).
 */
export interface AudioSettings {
  /** Master on/off for the bed on the watch surface. */
  enabled: boolean;
  mode: AudioMode;
  /** Master volume 0..1. Kept while muted so unmute restores the level. */
  volume: number;
  /** Hard-mute without losing the volume setting. */
  muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: false,
  mode: "auto",
  volume: 0.7,
  muted: false,
};

/** How elevation contour lines are coloured. */
export type ElevationLineColor = "default" | "elevation" | "custom";

/**
 * Tunable elevation contour-line look — the terrain LINE overlay (distinct from
 * the filled "relief" basemap). Lines can be a flat colour, coloured by height
 * (bathymetry cool → peaks warm), or a flat operator-picked colour.
 */
export interface ElevationSettings {
  colorMode: ElevationLineColor;
  /** Flat line colour (hex `#rrggbb`) used when colorMode is "default"/"custom". */
  color: string;
  /** Line width in pixels. */
  width: number;
  /** Line opacity 0..1. */
  opacity: number;
  /** Minor contour spacing, metres. */
  interval: number;
  /** Major (bold, emphasised) contour spacing, metres. */
  majorInterval: number;
}

export const DEFAULT_ELEVATION_SETTINGS: ElevationSettings = {
  colorMode: "elevation",
  color: "#ffe0b2",
  width: 1.5,
  opacity: 1,
  interval: 250,
  majorInterval: 1000,
};

/**
 * How a track type's markers are coloured. "custom" uses `TrackStyle.customColor`
 * (a flat operator-chosen hex); the others are data-driven gradients.
 */
export type TrackColorMode = "kind" | "speed" | "altitude" | "country" | "custom";
/** Marker shape for aircraft/ships (satellites always render as dots). */
export type TrackIconMode = "dot" | "arrow" | "glyph";

/**
 * Per-type marker styling + display filters — satellites, aircraft and ships are
 * each configured independently. All filter fields default to "off" (0 / unset /
 * false) so the overlay shows everything until the operator dials something in.
 */
export interface TrackStyle {
  color: TrackColorMode;
  icon: TrackIconMode;
  /** Flat marker colour (hex `#rrggbb`) used when `color` === "custom". */
  customColor?: string;
  /** Marker opacity 0–1 (fill alpha). Undefined = fully opaque. */
  opacity?: number;
  // ── Display filters (0 / unset = no filter) ──
  /** Hide tracks below this altitude, metres (aircraft AGL / satellite orbit). */
  minAltM?: number;
  /** Hide tracks above this altitude, metres (satellite band ceiling). */
  maxAltM?: number;
  /** Hide tracks slower than this: m/s for aircraft/satellite, knots for ships. */
  minSpeed?: number;
  /** Keep only tracks whose country matches one of these (comma-list, substring, case-insensitive). */
  country?: string;
  /** Aircraft only: hide on-ground traffic (altitude ≈ 0). */
  hideGround?: boolean;
}
export const DEFAULT_TRACK_STYLE: TrackStyle = {
  color: "kind",
  icon: "arrow",
  customColor: "#facc15",
  opacity: 1,
  minAltM: 0,
  maxAltM: 0,
  minSpeed: 0,
  country: "",
  hideGround: false,
};
export const DEFAULT_SATELLITE_STYLE: TrackStyle = {
  ...DEFAULT_TRACK_STYLE,
  icon: "dot",
  customColor: "#38bdf8",
};

/** Clamp a number into [lo, hi], falling back to `dflt` if not finite. */
const clampNum = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

/**
 * Merge a (possibly untrusted) partial per-feed clouds patch onto a base, validating
 * each known feed's `on`/`opacity`. Always returns exactly the registered feed ids so
 * the shape round-trips deterministically through the control→/watch sync.
 */
function mergeSatImgFeeds(
  base: Record<string, SatImgFeedState> | undefined,
  patch: Record<string, Partial<SatImgFeedState>> | undefined,
): Record<string, SatImgFeedState> {
  const out: Record<string, SatImgFeedState> = {};
  for (const id of Object.keys(DEFAULT_SATIMG_FEEDS)) {
    const b = base?.[id] ?? DEFAULT_SATIMG_FEEDS[id];
    const p = patch?.[id] ?? {};
    const look = isSatImgLook(p.look) ? p.look : b.look;
    out[id] = {
      on: typeof p.on === "boolean" ? p.on : b.on,
      opacity: clampNum(p.opacity, 0, 1, b.opacity),
      // Discs carry a composite look; mosaic/overlay feeds leave it undefined.
      ...(look !== undefined ? { look } : {}),
    };
  }
  return out;
}

/**
 * Merge a (possibly untrusted) partial TrackStyle onto a base, validating each
 * field. Shared by all three per-type styles in mergeControlState.
 */
export function mergeTrackStyle(base: TrackStyle, patch: Partial<TrackStyle> | undefined, dflt: TrackStyle): TrackStyle {
  const b = base ?? dflt;
  const p = patch ?? {};
  const out: TrackStyle = {
    color: (p.color ?? b.color ?? dflt.color) as TrackColorMode,
    icon: (p.icon ?? b.icon ?? dflt.icon) as TrackIconMode,
    customColor:
      typeof p.customColor === "string" ? p.customColor : b.customColor ?? dflt.customColor,
    opacity: clampNum(p.opacity ?? b.opacity, 0, 1, dflt.opacity ?? 1),
    minAltM: clampNum(p.minAltM ?? b.minAltM, 0, 6e7, 0),
    maxAltM: clampNum(p.maxAltM ?? b.maxAltM, 0, 6e7, 0),
    minSpeed: clampNum(p.minSpeed ?? b.minSpeed, 0, 1e5, 0),
    country: typeof p.country === "string" ? p.country : b.country ?? "",
    hideGround: typeof p.hideGround === "boolean" ? p.hideGround : b.hideGround ?? false,
  };
  return out;
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
  /** Colours for the dark (vector) basemap. Raster basemaps ignore these. */
  basemapColors: BasemapColors;
  /** Wind particle appearance. */
  wind: WindSettings;
  /** Draw wind as flowing particles or meteorological barbs. */
  windMode: WindMode;
  /** Isolines for the active scalar variable. */
  showContours: boolean;
  /** Static terrain contour LINE overlay (the "relief" basemap is separate). */
  showElevation: boolean;
  /** Elevation contour-line appearance (colour mode, width, opacity, intervals). */
  elevation: ElevationSettings;
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
   * Slow zoom-in per second ("push-in"/Ken Burns) for detail shots that must
   * stay centred on their subject instead of orbiting away from it. Deterministic
   * off spinEpoch like the spin, so /control and /watch push in together. 0 = off.
   */
  zoomDrift: number;
  /**
   * Wall-clock ms when the current spin/push anchor was set. Both /control and
   * /watch compute longitude = camera.center[0] + spinSpeed*(now-spinEpoch)/1000
   * and zoom = camera.zoom + zoomDrift*(now-spinEpoch)/1000, so they move in phase
   * from the same anchor with no per-frame socket traffic.
   */
  spinEpoch: number;
  /**
   * Fixed camera-flight duration for a director cut, in ms. The auto-director
   * stamps this on every cut's patch (from its `transitionSeconds` setting) so
   * each shot flies in for the same deliberate, set time instead of the default
   * distance-scaled duration. 0 = auto (manual operator flyTo keeps auto).
   */
  cutTransitionMs: number;
  /** Show name labels on the live-track overlay (decluttered). */
  showTrackLabels: boolean;
  /** Marker styling + filters for satellites (icon is always a dot). */
  satelliteStyle: TrackStyle;
  /** Marker styling + filters for aircraft, independent of ships. */
  aircraftStyle: TrackStyle;
  /** Marker styling + filters for ships, independent of aircraft. */
  shipStyle: TrackStyle;
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
  /**
   * Hazard types HIDDEN from the alert overlay (empty = show everything).
   * Stored as an off-list so newly added hazard types default to visible.
   */
  alertHazardsOff: HazardType[];
  /** Overlay recent earthquakes (USGS) on the globe. */
  showSeismic: boolean;
  /** Only show quakes at/above this magnitude. */
  seismicMinMag: number;
  /** Overlay submarine fiber-optic cables + landing stations on the globe. */
  showCables: boolean;
  /** Label each submarine cable with its name (needs showCables). */
  showCableLabels: boolean;
  /** Overlay tectonic plate boundaries (Bird 2003) on the globe. */
  showFaults: boolean;
  /** Overlay the live aurora oval (NOAA SWPC OVATION) — a geomagnetic activity map. */
  showAurora: boolean;
  /** Aurora oval overlay opacity (0–1). */
  auroraOpacity: number;
  /** Master toggle for the satellite "clouds" overlay (per-feed state in satImgFeeds). */
  showSatImg: boolean;
  /** Per-feed clouds state — each source's on-flag + opacity + (disc) composite look. */
  satImgFeeds: Record<string, SatImgFeedState>;
  /** Overlay active-fire detections (NASA FIRMS VIIRS/MODIS hot-spots). */
  showFires: boolean;
  /** Overlay the global geomagnetic-field intensity (IGRF) — the whole-globe magnetic map. */
  showMagneticField: boolean;
  /** Geomagnetic-field overlay opacity (0–1). */
  magneticFieldOpacity: number;
  /** DEBUG: outline each active weather-map source's bbox + label on the globe, so
   *  the operator can see which model (base/nest) renders where and check alignment. */
  showMapSource: boolean;
  /** Overlay the reference graticule (equator, tropics, polar circles, meridians). */
  showGraticule: boolean;
  /** Graticule line + label colour (hex `#rrggbb`). */
  graticuleColor: string;
  /** Draw the named labels (Equator, Tropic of Cancer …) on the graticule. */
  graticuleLabels: boolean;
  /** Atmospheric rim glow + pedestal ring around the globe (broadcast beauty). */
  showAtmosphere: boolean;
  /** Shade the night hemisphere from the real sun position + light up night cities. */
  showDayNight: boolean;
  /** Overlay the broadcast chrome (tickers, brand, LIVE, alert panel, monitor). */
  showBroadcastChrome: boolean;
  /** Broadcast chrome theme/brand preset id (see broadcast/config). */
  broadcastTheme: string;
  /** Generative music bed played on /watch (mode/volume/mute, operator-driven). */
  audio: AudioSettings;
  /**
   * Wall-clock ms target for the pre-broadcast countdown reveal. While set and
   * in the future, /watch covers the globe with a "starting in…" countdown +
   * credits screen instead of the live broadcast. Null = no countdown pending
   * (go straight to the live surface).
   */
  startAt: number | null;
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
  showElevation: false,
  elevation: { ...DEFAULT_ELEVATION_SETTINGS },
  showRadar: false,
  showSatellites: false,
  showAircraft: false,
  showShips: false,
  satelliteGroup: "visual",
  autoSpin: false,
  spinSpeed: 8,
  zoomDrift: 0,
  spinEpoch: 0,
  cutTransitionMs: 0,
  showTrackLabels: false,
  satelliteStyle: { ...DEFAULT_SATELLITE_STYLE },
  aircraftStyle: { ...DEFAULT_TRACK_STYLE },
  shipStyle: { ...DEFAULT_TRACK_STYLE },
  showOrbits: false,
  showTrails: false,
  trailMinutes: 30,
  trailOpacity: 0.35,
  showAlerts: false,
  alertSeverityMin: 0,
  alertHazardsOff: [],
  showSeismic: false,
  seismicMinMag: 2.5,
  showCables: false,
  showCableLabels: false,
  showFaults: false,
  showAurora: false,
  auroraOpacity: 0.85,
  showSatImg: false,
  satImgFeeds: defaultSatImgFeeds(),
  showFires: false,
  showMagneticField: false,
  magneticFieldOpacity: 0.8,
  showMapSource: false,
  showGraticule: false,
  graticuleColor: "#7dd3fc",
  graticuleLabels: true,
  showAtmosphere: true,
  showDayNight: false,
  showBroadcastChrome: true,
  broadcastTheme: "aurora",
  audio: { ...DEFAULT_AUDIO_SETTINGS },
  startAt: null,
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
    showElevation:
      typeof patch.showElevation === "boolean" ? patch.showElevation : base.showElevation ?? false,
    elevation: {
      colorMode:
        patch.elevation?.colorMode ?? base.elevation?.colorMode ?? DEFAULT_ELEVATION_SETTINGS.colorMode,
      color: patch.elevation?.color ?? base.elevation?.color ?? DEFAULT_ELEVATION_SETTINGS.color,
      width:
        typeof patch.elevation?.width === "number"
          ? patch.elevation.width
          : base.elevation?.width ?? DEFAULT_ELEVATION_SETTINGS.width,
      opacity:
        typeof patch.elevation?.opacity === "number"
          ? patch.elevation.opacity
          : base.elevation?.opacity ?? DEFAULT_ELEVATION_SETTINGS.opacity,
      interval:
        typeof patch.elevation?.interval === "number"
          ? patch.elevation.interval
          : base.elevation?.interval ?? DEFAULT_ELEVATION_SETTINGS.interval,
      majorInterval:
        typeof patch.elevation?.majorInterval === "number"
          ? patch.elevation.majorInterval
          : base.elevation?.majorInterval ?? DEFAULT_ELEVATION_SETTINGS.majorInterval,
    },
    showRadar: typeof patch.showRadar === "boolean" ? patch.showRadar : base.showRadar ?? false,
    showSatellites:
      typeof patch.showSatellites === "boolean" ? patch.showSatellites : base.showSatellites ?? false,
    showAircraft:
      typeof patch.showAircraft === "boolean" ? patch.showAircraft : base.showAircraft ?? false,
    showShips: typeof patch.showShips === "boolean" ? patch.showShips : base.showShips ?? false,
    satelliteGroup: patch.satelliteGroup ?? base.satelliteGroup ?? "visual",
    autoSpin: typeof patch.autoSpin === "boolean" ? patch.autoSpin : base.autoSpin ?? false,
    spinSpeed: typeof patch.spinSpeed === "number" ? patch.spinSpeed : base.spinSpeed ?? 8,
    zoomDrift: typeof patch.zoomDrift === "number" ? patch.zoomDrift : base.zoomDrift ?? 0,
    spinEpoch: typeof patch.spinEpoch === "number" ? patch.spinEpoch : base.spinEpoch ?? 0,
    cutTransitionMs:
      typeof patch.cutTransitionMs === "number" ? patch.cutTransitionMs : base.cutTransitionMs ?? 0,
    showTrackLabels:
      typeof patch.showTrackLabels === "boolean"
        ? patch.showTrackLabels
        : base.showTrackLabels ?? false,
    satelliteStyle: mergeTrackStyle(base.satelliteStyle, patch.satelliteStyle, DEFAULT_SATELLITE_STYLE),
    aircraftStyle: mergeTrackStyle(base.aircraftStyle, patch.aircraftStyle, DEFAULT_TRACK_STYLE),
    shipStyle: mergeTrackStyle(base.shipStyle, patch.shipStyle, DEFAULT_TRACK_STYLE),
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
    alertHazardsOff: Array.isArray(patch.alertHazardsOff)
      ? [...new Set(patch.alertHazardsOff.filter(isHazardType))]
      : base.alertHazardsOff ?? [],
    showSeismic: typeof patch.showSeismic === "boolean" ? patch.showSeismic : base.showSeismic ?? false,
    seismicMinMag:
      typeof patch.seismicMinMag === "number" ? patch.seismicMinMag : base.seismicMinMag ?? 2.5,
    showCables: typeof patch.showCables === "boolean" ? patch.showCables : base.showCables ?? false,
    showCableLabels:
      typeof patch.showCableLabels === "boolean" ? patch.showCableLabels : base.showCableLabels ?? false,
    showFaults: typeof patch.showFaults === "boolean" ? patch.showFaults : base.showFaults ?? false,
    showAurora: typeof patch.showAurora === "boolean" ? patch.showAurora : base.showAurora ?? false,
    auroraOpacity:
      typeof patch.auroraOpacity === "number" ? patch.auroraOpacity : base.auroraOpacity ?? 0.85,
    showSatImg: typeof patch.showSatImg === "boolean" ? patch.showSatImg : base.showSatImg ?? false,
    satImgFeeds: mergeSatImgFeeds(base.satImgFeeds, patch.satImgFeeds),
    showFires: typeof patch.showFires === "boolean" ? patch.showFires : base.showFires ?? false,
    showMagneticField:
      typeof patch.showMagneticField === "boolean" ? patch.showMagneticField : base.showMagneticField ?? false,
    magneticFieldOpacity:
      typeof patch.magneticFieldOpacity === "number"
        ? patch.magneticFieldOpacity
        : base.magneticFieldOpacity ?? 0.8,
    showMapSource:
      typeof patch.showMapSource === "boolean" ? patch.showMapSource : base.showMapSource ?? false,
    showGraticule:
      typeof patch.showGraticule === "boolean" ? patch.showGraticule : base.showGraticule ?? false,
    graticuleColor:
      typeof patch.graticuleColor === "string" ? patch.graticuleColor : base.graticuleColor ?? "#7dd3fc",
    graticuleLabels:
      typeof patch.graticuleLabels === "boolean" ? patch.graticuleLabels : base.graticuleLabels ?? true,
    showAtmosphere:
      typeof patch.showAtmosphere === "boolean" ? patch.showAtmosphere : base.showAtmosphere ?? true,
    showDayNight:
      typeof patch.showDayNight === "boolean" ? patch.showDayNight : base.showDayNight ?? false,
    showBroadcastChrome:
      typeof patch.showBroadcastChrome === "boolean"
        ? patch.showBroadcastChrome
        : base.showBroadcastChrome ?? true,
    broadcastTheme:
      typeof patch.broadcastTheme === "string" ? patch.broadcastTheme : base.broadcastTheme ?? "aurora",
    audio: {
      enabled:
        typeof patch.audio?.enabled === "boolean"
          ? patch.audio.enabled
          : base.audio?.enabled ?? DEFAULT_AUDIO_SETTINGS.enabled,
      mode: AUDIO_MODES.includes(patch.audio?.mode as AudioMode)
        ? (patch.audio?.mode as AudioMode)
        : base.audio?.mode ?? DEFAULT_AUDIO_SETTINGS.mode,
      volume: clampNum(patch.audio?.volume ?? base.audio?.volume, 0, 1, DEFAULT_AUDIO_SETTINGS.volume),
      muted:
        typeof patch.audio?.muted === "boolean"
          ? patch.audio.muted
          : base.audio?.muted ?? DEFAULT_AUDIO_SETTINGS.muted,
    },
    startAt:
      patch.startAt === null ? null : typeof patch.startAt === "number" ? patch.startAt : base.startAt ?? null,
  };
}

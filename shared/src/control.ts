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
import { isWidgetId, type WidgetId } from "./broadcast-widgets";
import { isSlideId, DEFAULT_SLIDE_HOLD_MS, type SlideId } from "./broadcast-slides";
import { clampReadCps, DEFAULT_READ_CPS } from "./reading-pace";
import {
  isReportSlideId,
  isReportKind,
  DEFAULT_REPORT_HOLD_MS,
  type ReportSlideId,
  type ReportKind,
} from "./broadcast-report";
import { isTickerKind, type TickerKind } from "./broadcast-ticker";
import { isPointVar, type PointVar } from "./point-vars";

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
/** Worker → browser: a new per-country/region AI round-up was generated (admin refetch). */
export const PLACE_ROUNDUPS_UPDATED = "placeRoundups:updated" as const;

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

/**
 * Operator preferences for live-platform chat monitoring on this scene. Chat is
 * OPERATOR-ONLY (a /control panel) and never rendered on /watch by default — see
 * docs/streaming-runs-plan.md decision 4. Persisted per-scene so the preference
 * survives across the streaming runs that scene hosts.
 */
export interface ChatSettings {
  /** Poll + surface this scene's live-run chat in the operator LiveChatPanel. */
  enabled: boolean;
  /** Allow the operator to promote a chat message into the on-air summary ticker. */
  promoteToTicker: boolean;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  enabled: false,
  promoteToTicker: false,
};

/**
 * Per-channel copy for the ABOUT slide of the top-right WORLD REPORT deck —
 * the channel's own description card (what it is, the data sources it uses).
 * Every field falls back PER-FIELD to the built-in G.O.D.S. copy when left
 * empty, so existing channels render exactly as before until an operator
 * writes their own text. Edited on /admin/scenes/:id.
 */
export interface AboutSettings {
  /** Card heading. Empty = the built-in "About G.O.D.S.". */
  title: string;
  /** Body copy — a blank line starts a new paragraph. Empty = built-in copy. */
  body: string;
  /**
   * Data-source credits shown as their own DATA SOURCES line — one per line or
   * comma-separated ("NOAA GFS, USGS, GDACS"). Empty = no sources line.
   */
  sources: string;
  /** Small print under the divider. Empty = the built-in "not an official warning service" disclaimer. */
  footer: string;
}

export const DEFAULT_ABOUT_SETTINGS: AboutSettings = {
  title: "",
  body: "",
  sources: "",
  footer: "",
};

/**
 * What this channel's YouTube broadcasts are published with. Templates (same
 * `%` date codes as the stream title) are resolved by the worker once, when a
 * broadcast is created; every field empty = the built-in defaults.
 */
export interface YoutubeSettings {
  /** Broadcast title template. Empty = "Live — <channel> — <date>". A run/slot title overrides it. */
  title: string;
  /** Broadcast description template. Empty = YOUTUBE_DESCRIPTION, else the built-in globe blurb. */
  description: string;
  /** Thumbnail image: http(s) URL or site path (/x.png). Empty = YOUTUBE_THUMBNAIL_URL, else the logo. */
  thumbnailUrl: string;
}

export const DEFAULT_YOUTUBE_SETTINGS: YoutubeSettings = {
  title: "",
  description: "",
  thumbnailUrl: "",
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
/**
 * Per-channel brand overrides layered over a base BroadcastTheme preset. Each
 * field is optional; a set (non-empty) value replaces the preset's, an empty or
 * absent one falls back to the preset. Persisted on ControlState.themeOverrides.
 */
export interface ThemeOverrides {
  name?: string;
  tagline?: string;
  strapline?: string;
  tickerTitle?: string;
  meterTitle?: string;
  accent?: string;
  panelBg?: string;
  panelBorder?: string;
  /** ALL-CAPS panel/widget title ink. */
  titleColor?: string;
  /** Card body ink. */
  textColor?: string;
  /** Muted eyebrow/caption ink. */
  mutedColor?: string;
  /** Dimmest caption ink. */
  dimColor?: string;
  /** LIVE badge / ON AIR pip colour. */
  liveColor?: string;
  /** Ticker crawl band background (raw CSS). */
  tickerBg?: string;
  /** Ticker crawl text ink. */
  tickerText?: string;
  /** G.O.D.S. masthead SVG panel gradient colours. */
  godsPanelTopColor?: string;
  godsPanelMidColor?: string;
  godsPanelBottomColor?: string;
  /** G.O.D.S. masthead bezel / panel hairline colour. */
  godsBorderColor?: string;
  /** Inset tiles used by feeds, forecasts, charts, and monitor boxes. */
  tileColor?: string;
  tileBorderColor?: string;
  /** Main-map chrome colours for selected subjects and place labels. */
  mapHighlightColor?: string;
  mapLabelColor?: string;
  mapCapitalColor?: string;
  /** Locator minimap ocean gradient, land fill, and reticle colours. */
  minimapOceanInnerColor?: string;
  minimapOceanOuterColor?: string;
  minimapLandColor?: string;
  minimapLandEdgeColor?: string;
  minimapGridColor?: string;
  minimapLimbColor?: string;
  minimapAccentColor?: string;
}

/** One named point shown by the top-right location-weather slide. */
export interface WeatherLocation {
  label: string;
  lat: number;
  lng: number;
}

/** The keys sanitised through mergeControlState / persisted for a theme override. */
export const THEME_OVERRIDE_KEYS = [
  "name",
  "tagline",
  "strapline",
  "tickerTitle",
  "meterTitle",
  "accent",
  "panelBg",
  "panelBorder",
  "titleColor",
  "textColor",
  "mutedColor",
  "dimColor",
  "liveColor",
  "tickerBg",
  "tickerText",
  "godsPanelTopColor",
  "godsPanelMidColor",
  "godsPanelBottomColor",
  "godsBorderColor",
  "tileColor",
  "tileBorderColor",
  "mapHighlightColor",
  "mapLabelColor",
  "mapCapitalColor",
  "minimapOceanInnerColor",
  "minimapOceanOuterColor",
  "minimapLandColor",
  "minimapLandEdgeColor",
  "minimapGridColor",
  "minimapLimbColor",
  "minimapAccentColor",
] as const;

/** Idle-motion defaults: a gentle 3° orbit + quarter-level breathe over a minute
 *  reads as "alive" at country zoom without ever pulling the subject off frame
 *  (the client additionally caps the orbit pan by zoom — see orbitAmpCap). */
export const DEFAULT_IDLE_ORBIT_DEG = 3;
export const DEFAULT_IDLE_BREATHE = 0.25;
export const DEFAULT_IDLE_PERIOD_S = 60;

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
   * Slow orbit RADIUS in degrees for framed "area" shots (country /
   * weather) — the camera circles the framed centre so the shot is alive without
   * the subject drifting off-screen (unlike autoSpin, which advances longitude
   * unbounded). Deterministic off spinEpoch like the spin/push-in: the amplitude
   * eases out from the anchor after the fly-in settles, so /control and /watch
   * trace the same circle and there's no pop when the cut lands. 0 = off.
   */
  orbitDrift: number;
  /**
   * Per-channel IDLE camera motion: keep a shot settled on a location alive
   * with a slight drift — a slow orbit round the anchor and/or a gentle zoom
   * "breathe" in and back out. Unlike zoomDrift/orbitDrift (which the
   * auto-director stamps per cut), this is a standing channel preference that
   * COMPOSES with a hold: the orbit rides along with a director push-in (so a
   * detail shot keeps circling its subject), a set breathe REPLACES the
   * push-in outright — its in-and-back sway owns the zoom from the moment the
   * cut lands — and both yield to autoSpin and the director's own orbit (see
   * idle-motion.ts gates).
   * Deterministic off spinEpoch like the rest, so /control and /watch drift
   * in phase.
   */
  idleMotion: boolean;
  /** Idle-motion orbit pan radius in degrees round the anchor (0 = no orbit). */
  idleOrbit: number;
  /** Idle-motion zoom breathe amplitude in zoom levels — the camera eases in by
   *  this much and back out each cycle, never wider than the anchor (0 = off). */
  idleBreathe: number;
  /** Seconds for one full idle orbit circle / breathe cycle. */
  idlePeriodS: number;
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
  /**
   * Light ONE hazard type at a time while a shot holds, cycling through the
   * types actually in frame (wind → rain → snow …) instead of drawing every
   * warning at once.
   *
   * The worker dissolves blobs per hazard+severity, so a country under four
   * kinds of warning gets four shapes over the same ground — and each is painted
   * in four passes (halo, glow, fill, edge). Stacked, they mix into a slab that
   * hides the weather underneath. Cycling gives each type a beat of its own; the
   * rest stay as ghost outlines, so the whole picture is still readable.
   *
   * Off = the old draw-everything-at-once behaviour (the operator's escape
   * hatch). Inert either way when fewer than two hazard types are in frame.
   */
  alertCycle: boolean;
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
  /** Overlay currently-active volcanoes (NASA EONET). */
  showVolcanoes: boolean;
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
  /**
   * Chrome widgets HIDDEN on this channel (empty = show everything). An off-list
   * keyed by BROADCAST_WIDGETS ids — newly added widgets default to visible on
   * every existing channel. Only meaningful while `showBroadcastChrome` is on.
   */
  widgetsOff: WidgetId[];
  /**
   * Bottom-left deck slides HIDDEN on this channel (empty = show all). An
   * off-list keyed by BROADCAST_SLIDES ids; the pinned `onair` lede is never
   * dropped even if listed.
   */
  slidesOff: SlideId[];
  /**
   * Per-channel ranking for the bottom-left deck slides — a stable-sort key
   * applied over the mode's natural order (pinned `onair` always first, listed
   * ids next in this order, everything else keeps its natural position). Empty =
   * natural order.
   */
  slideOrder: SlideId[];
  /** Bottom-left deck rotation dwell in ms (how long each slide holds). */
  slideHoldMs: number;
  /**
   * Top-right WORLD REPORT deck slides HIDDEN on this channel (empty = show all).
   * Off-list keyed by BROADCAST_REPORT_SLIDES ids — this is how one globe is
   * pared into themed channels (a seismic channel hides the weather slides, etc.).
   */
  reportOff: ReportSlideId[];
  /** Per-channel ranking for the WORLD REPORT deck slides (stable-sort key). */
  reportOrder: ReportSlideId[];
  /** WORLD REPORT deck rotation dwell in ms (how long each slide holds). */
  reportHoldMs: number;
  /** Named point forecasts shown by the location-weather report slide. Empty =
   * use the live camera position, so the slide is never a global forecast. */
  weatherLocations: WeatherLocation[];
  /**
   * Event KINDS excluded from the WORLD REPORT (empty = all). Drops the kind from
   * BOTH the detection grid and the active feed — how a themed channel's whole
   * report is scoped (a seismic channel hides "alert"; a weather channel hides
   * "quake" + "volcano").
   */
  reportKindsOff: ReportKind[];
  /**
   * Alert HAZARD types excluded from the WORLD REPORT feed + grid (empty = all).
   * Report-specific (independent of the globe overlay's `alertHazardsOff`) — a
   * fire channel keeps only "fire", a flood channel drops "fire"/"heat", etc.
   */
  reportHazardsOff: HazardType[];
  /**
   * Content KINDS excluded from the bottom crawl (empty = all). Off-list keyed
   * by TICKER_KINDS ids — scopes the GLOBAL FEED band to the channel's theme
   * (a seismic channel drops "alert"/"track", an ad-free channel drops "ad").
   */
  tickerKindsOff: TickerKind[];
  /**
   * Alert HAZARD types excluded from the bottom crawl (empty = all). Crawl-
   * specific (independent of both the globe overlay's `alertHazardsOff` and the
   * report's `reportHazardsOff`) — only meaningful while the "alert" kind is on.
   */
  tickerHazardsOff: HazardType[];
  /**
   * On-air READING PACE in characters per second — the one knob every scrolling
   * surface sizes itself from (the bottom crawl, the WORLD REPORT row marquee,
   * the deck cards' auto-scrolling bodies). Each derives its own motion from its
   * own content length, so this stays a reading speed rather than a px/s tuned
   * per surface. Default 15 cps ≈ 150 wpm; see reading-pace.ts.
   */
  readPaceCps: number;
  /**
   * Weather variables HIDDEN from the POINT / AREA HISTORY card (empty = show
   * all). Off-list keyed by POINT_VARS ids.
   */
  pointVarsOff: PointVar[];
  /**
   * Per-channel brand overrides layered over the `broadcastTheme` preset — any
   * non-empty field replaces the preset's (name, tagline, accent, …). Empty {} =
   * use the preset unchanged. Resolved by getBroadcastTheme().
   */
  themeOverrides: ThemeOverrides;
  /**
   * Per-channel copy for the top-right ABOUT card (description + data-source
   * credits). Empty fields fall back to the built-in G.O.D.S. copy.
   */
  about: AboutSettings;
  /** Title / description / thumbnail this channel's YouTube broadcasts are created with. */
  youtube: YoutubeSettings;
  /** Generative music bed played on /watch (mode/volume/mute, operator-driven). */
  audio: AudioSettings;
  /** Live-platform chat monitoring preference for this scene (operator-only). */
  chat: ChatSettings;
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
  orbitDrift: 0,
  idleMotion: false,
  idleOrbit: DEFAULT_IDLE_ORBIT_DEG,
  idleBreathe: DEFAULT_IDLE_BREATHE,
  idlePeriodS: DEFAULT_IDLE_PERIOD_S,
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
  alertCycle: true,
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
  showVolcanoes: false,
  showMagneticField: false,
  magneticFieldOpacity: 0.8,
  showMapSource: false,
  showGraticule: false,
  graticuleColor: "#7dd3fc",
  graticuleLabels: true,
  showAtmosphere: true,
  showDayNight: false,
  showBroadcastChrome: true,
  broadcastTheme: "command",
  widgetsOff: [],
  slidesOff: [],
  slideOrder: [],
  slideHoldMs: DEFAULT_SLIDE_HOLD_MS,
  reportOff: [],
  reportOrder: [],
  reportHoldMs: DEFAULT_REPORT_HOLD_MS,
  weatherLocations: [],
  reportKindsOff: [],
  reportHazardsOff: [],
  tickerKindsOff: [],
  tickerHazardsOff: [],
  readPaceCps: DEFAULT_READ_CPS,
  pointVarsOff: [],
  themeOverrides: {},
  about: { ...DEFAULT_ABOUT_SETTINGS },
  youtube: { ...DEFAULT_YOUTUBE_SETTINGS },
  audio: { ...DEFAULT_AUDIO_SETTINGS },
  chat: { ...DEFAULT_CHAT_SETTINGS },
  startAt: null,
};

/**
 * Pick only the known string-valued theme-override keys off an untrusted object.
 * Returns undefined when the patch carries no themeOverrides at all (so the merge
 * keeps the base), or a fresh sanitised object (empty strings allowed — they
 * clear a field back to the preset at resolve time).
 */
function sanitizeThemeOverrides(v: Partial<ThemeOverrides> | undefined): ThemeOverrides | undefined {
  if (!v || typeof v !== "object") return undefined;
  const src = v as Record<string, unknown>;
  const out: ThemeOverrides = {};
  for (const k of THEME_OVERRIDE_KEYS) {
    const val = src[k];
    if (typeof val === "string") out[k] = val;
  }
  return out;
}

/** Keep at most four valid, named point forecasts for the compact report card. */
function sanitizeWeatherLocations(value: unknown): WeatherLocation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: WeatherLocation[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim().slice(0, 80) : "";
    const lat = Number(item.lat);
    const lng = Number(item.lng);
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    out.push({ label, lat, lng });
    if (out.length === 4) break;
  }
  return out;
}

/**
 * Merge a partial (possibly untrusted, from socket/HTTP) control patch onto a
 * base state, keeping unknown/missing fields at their previous value. Pure —
 * used by both client and server, and unit-tested.
 */
/** Structural equality for the JSON-shaped values ControlState holds. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameValue(v, bb[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  return ka.length === Object.keys(rb).length && ka.every((k) => k in rb && sameValue(ra[k], rb[k]));
}

/**
 * Reuse `base`'s nested objects/arrays wherever the merge produced a
 * structurally identical value. `buildControlState` allocates every nested
 * value afresh (wind, basemapColors, elevation, camera, the *Off lists …), and
 * consumers key effects on those identities — so a socket beat that changed
 * nothing used to rebuild the whole deck.gl layer stack. After this pass, a
 * new identity means the value actually changed.
 */
function reuseUnchanged(base: ControlState, next: ControlState): ControlState {
  const b = base as unknown as Record<string, unknown>;
  const n = next as unknown as Record<string, unknown>;
  let same = true;
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (v !== null && typeof v === "object" && sameValue(v, b[k])) n[k] = b[k];
    if (n[k] !== b[k]) same = false;
  }
  // Nothing changed at all → hand back `base` itself. A socket heartbeat that
  // repeats the current state then leaves React state identity untouched, so
  // memoised consumers (the whole /watch chrome) skip the re-render.
  return same && Object.keys(b).length === Object.keys(n).length ? base : next;
}

export function mergeControlState(base: ControlState, patch: Partial<ControlState>): ControlState {
  return reuseUnchanged(base, buildControlState(base, patch));
}

function buildControlState(base: ControlState, patch: Partial<ControlState>): ControlState {
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
    orbitDrift: typeof patch.orbitDrift === "number" ? patch.orbitDrift : base.orbitDrift ?? 0,
    idleMotion:
      typeof patch.idleMotion === "boolean" ? patch.idleMotion : base.idleMotion ?? false,
    idleOrbit: clampNum(patch.idleOrbit ?? base.idleOrbit, 0, 30, DEFAULT_IDLE_ORBIT_DEG),
    idleBreathe: clampNum(patch.idleBreathe ?? base.idleBreathe, 0, 2, DEFAULT_IDLE_BREATHE),
    idlePeriodS: clampNum(patch.idlePeriodS ?? base.idlePeriodS, 10, 600, DEFAULT_IDLE_PERIOD_S),
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
    // Defaults ON for states persisted before the cycle existed — the stacked
    // draw it replaces is the bug, not the baseline.
    alertCycle: typeof patch.alertCycle === "boolean" ? patch.alertCycle : base.alertCycle ?? true,
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
    showVolcanoes:
      typeof patch.showVolcanoes === "boolean" ? patch.showVolcanoes : base.showVolcanoes ?? false,
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
      typeof patch.broadcastTheme === "string" ? patch.broadcastTheme : base.broadcastTheme ?? "command",
    widgetsOff: Array.isArray(patch.widgetsOff)
      ? [...new Set(patch.widgetsOff.filter(isWidgetId))]
      : base.widgetsOff ?? [],
    slidesOff: Array.isArray(patch.slidesOff)
      ? [...new Set(patch.slidesOff.filter(isSlideId))]
      : base.slidesOff ?? [],
    slideOrder: Array.isArray(patch.slideOrder)
      ? [...new Set(patch.slideOrder.filter(isSlideId))]
      : base.slideOrder ?? [],
    slideHoldMs:
      typeof patch.slideHoldMs === "number" && patch.slideHoldMs > 0
        ? patch.slideHoldMs
        : base.slideHoldMs ?? DEFAULT_SLIDE_HOLD_MS,
    reportOff: Array.isArray(patch.reportOff)
      ? [...new Set(patch.reportOff.filter(isReportSlideId))]
      : base.reportOff ?? [],
    reportOrder: Array.isArray(patch.reportOrder)
      ? [...new Set(patch.reportOrder.filter(isReportSlideId))]
      : base.reportOrder ?? [],
    reportHoldMs:
      typeof patch.reportHoldMs === "number" && patch.reportHoldMs > 0
        ? patch.reportHoldMs
        : base.reportHoldMs ?? DEFAULT_REPORT_HOLD_MS,
    weatherLocations: sanitizeWeatherLocations(patch.weatherLocations) ?? base.weatherLocations ?? [],
    reportKindsOff: Array.isArray(patch.reportKindsOff)
      ? [...new Set(patch.reportKindsOff.filter(isReportKind))]
      : base.reportKindsOff ?? [],
    reportHazardsOff: Array.isArray(patch.reportHazardsOff)
      ? [...new Set(patch.reportHazardsOff.filter(isHazardType))]
      : base.reportHazardsOff ?? [],
    tickerKindsOff: Array.isArray(patch.tickerKindsOff)
      ? [...new Set(patch.tickerKindsOff.filter(isTickerKind))]
      : base.tickerKindsOff ?? [],
    tickerHazardsOff: Array.isArray(patch.tickerHazardsOff)
      ? [...new Set(patch.tickerHazardsOff.filter(isHazardType))]
      : base.tickerHazardsOff ?? [],
    readPaceCps:
      patch.readPaceCps !== undefined
        ? clampReadCps(patch.readPaceCps)
        : clampReadCps(base.readPaceCps ?? DEFAULT_READ_CPS),
    pointVarsOff: Array.isArray(patch.pointVarsOff)
      ? [...new Set(patch.pointVarsOff.filter(isPointVar))]
      : base.pointVarsOff ?? [],
    themeOverrides: sanitizeThemeOverrides(patch.themeOverrides) ?? base.themeOverrides ?? {},
    about: {
      title:
        typeof patch.about?.title === "string"
          ? patch.about.title
          : base.about?.title ?? DEFAULT_ABOUT_SETTINGS.title,
      body:
        typeof patch.about?.body === "string"
          ? patch.about.body
          : base.about?.body ?? DEFAULT_ABOUT_SETTINGS.body,
      sources:
        typeof patch.about?.sources === "string"
          ? patch.about.sources
          : base.about?.sources ?? DEFAULT_ABOUT_SETTINGS.sources,
      footer:
        typeof patch.about?.footer === "string"
          ? patch.about.footer
          : base.about?.footer ?? DEFAULT_ABOUT_SETTINGS.footer,
    },
    youtube: {
      title:
        typeof patch.youtube?.title === "string"
          ? patch.youtube.title.slice(0, 100)
          : base.youtube?.title ?? DEFAULT_YOUTUBE_SETTINGS.title,
      description:
        typeof patch.youtube?.description === "string"
          ? patch.youtube.description.slice(0, 5_000)
          : base.youtube?.description ?? DEFAULT_YOUTUBE_SETTINGS.description,
      thumbnailUrl:
        typeof patch.youtube?.thumbnailUrl === "string"
          ? patch.youtube.thumbnailUrl.trim().slice(0, 500)
          : base.youtube?.thumbnailUrl ?? DEFAULT_YOUTUBE_SETTINGS.thumbnailUrl,
    },
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
    chat: {
      enabled:
        typeof patch.chat?.enabled === "boolean"
          ? patch.chat.enabled
          : base.chat?.enabled ?? DEFAULT_CHAT_SETTINGS.enabled,
      promoteToTicker:
        typeof patch.chat?.promoteToTicker === "boolean"
          ? patch.chat.promoteToTicker
          : base.chat?.promoteToTicker ?? DEFAULT_CHAT_SETTINGS.promoteToTicker,
    },
    startAt:
      patch.startAt === null ? null : typeof patch.startAt === "number" ? patch.startAt : base.startAt ?? null,
  };
}

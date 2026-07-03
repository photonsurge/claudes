/**
 * Curated establishing shots and per-kind layer presets for the auto-director.
 *
 * ROIs are the ambient "tour" filler the director falls back to when nothing
 * notable is happening — a global spread of regions so the channel always has
 * somewhere photogenic to point. PRESETS define which layers each SegmentKind
 * turns on; the worker merges a preset with a camera to make a Segment.patch.
 */
import { DEFAULT_ELEVATION_SETTINGS, type ControlState } from "./control";
import { DEFAULT_BASEMAP_ID } from "./basemaps";
import type { SegmentKind } from "./director";

export interface RegionOfInterest {
  id: string;
  name: string;
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
}

/** A photogenic global rotation for tour/weather filler segments. */
export const REGIONS_OF_INTEREST: RegionOfInterest[] = [
  { id: "n-atlantic", name: "North Atlantic", center: [-40, 45], zoom: 3 },
  { id: "gulf-caribbean", name: "Gulf & Caribbean", center: [-82, 22], zoom: 3.2 },
  { id: "us-east", name: "Eastern US", center: [-78, 38], zoom: 3.5 },
  { id: "us-west", name: "Western US", center: [-118, 38], zoom: 3.5 },
  { id: "w-europe", name: "Western Europe", center: [5, 50], zoom: 3.6 },
  { id: "mediterranean", name: "Mediterranean", center: [15, 38], zoom: 3.4 },
  { id: "w-africa", name: "West Africa", center: [0, 8], zoom: 3.2 },
  { id: "s-africa", name: "Southern Africa", center: [25, -28], zoom: 3.2 },
  { id: "middle-east", name: "Middle East", center: [47, 28], zoom: 3.4 },
  { id: "south-asia", name: "South Asia", center: [80, 22], zoom: 3.3 },
  { id: "se-asia", name: "Southeast Asia", center: [110, 10], zoom: 3.2 },
  { id: "e-asia", name: "East Asia", center: [125, 35], zoom: 3.4 },
  { id: "japan", name: "Japan", center: [138, 37], zoom: 3.8 },
  { id: "australia", name: "Australia", center: [134, -25], zoom: 3.2 },
  { id: "s-america", name: "South America", center: [-60, -15], zoom: 3 },
];

/** Global establishing shot — the intro/idle spin. */
export const GLOBAL_VIEW: { center: [number, number]; zoom: number } = {
  center: [0, 20],
  // Fills the frame height — the globe disk stays centred so nothing clips.
  zoom: 3.0,
};

/** Ocean world spins — same full-frame world view as the intro. */
export const OCEAN_VIEW_ZOOM = 3.0;

/**
 * Ocean "world map" modes — full-globe spins coloured by an ocean variable
 * (already ingested: sst/wave/salinity). The director rotates through these as
 * ambient filler alongside the temperature intro when the `ocean` kind is enabled.
 */
export interface OceanView {
  /** Segment subject id (→ "ocean:<id>"). */
  id: string;
  /** Variable registry id to make the active colour field. */
  variable: string;
  title: string;
  subtitle: string;
}

export const OCEAN_VIEWS: OceanView[] = [
  { id: "sst", variable: "sst", title: "Ocean Temperature", subtitle: "Sea surface temperature" },
  { id: "waves", variable: "wave", title: "Ocean Swell", subtitle: "Significant wave height" },
  { id: "salinity", variable: "salinity", title: "Ocean Salinity", subtitle: "Sea surface salinity" },
];

/**
 * Orbital "world" modes — a satellite constellation's orbits spun on a pulled-
 * back globe so the planes read clearly. `group` is a Celestrak group id (see
 * SATELLITE_GROUPS); the candidate builder only airs the ones actually ingested.
 */
export interface OrbitalView {
  /** Segment subject id (→ "orbital:<group>") and the satellite group to show. */
  group: string;
  title: string;
  subtitle: string;
  /**
   * Camera zoom for this constellation (higher = closer). Altitudes are true
   * scale, so the orbit shell's apparent height is set by the framing: LEO
   * (Starlink/stations, ~400–550 km) zooms IN so it fills the frame hugging the
   * globe, while MEO/GEO (GPS/Galileo, ~20–36k km) zooms OUT so the whole, much
   * larger ring fits. Falls back to ORBITAL_VIEW_ZOOM when unset.
   */
  zoom?: number;
}

export const ORBITAL_VIEWS: OrbitalView[] = [
  { group: "starlink", title: "Starlink", subtitle: "Low-Earth-orbit internet constellation", zoom: 3.0 },
  { group: "gps-ops", title: "GPS Constellation", subtitle: "Navigation · medium Earth orbit", zoom: 1.0 },
  { group: "galileo", title: "Galileo", subtitle: "European navigation constellation", zoom: 0.9 },
  { group: "stations", title: "Space Stations", subtitle: "ISS & crewed platforms", zoom: 3.2 },
  { group: "weather", title: "Weather Satellites", subtitle: "Polar & geostationary", zoom: 1.3 },
  { group: "visual", title: "Brightest Satellites", subtitle: "Visible to the naked eye", zoom: 2.6 },
];

/** Default orbital framing when a view doesn't set its own zoom. */
export const ORBITAL_VIEW_ZOOM = 2.4;

/**
 * The map a `quake` shot reads through. Earthquakes are geophysical, so no GFS
 * weather field is truly relevant — the map is a backdrop, not a forecast. Two
 * modes: a tsunami-flagged quake tells the ocean story (sea-surface temp → swell
 * height); an ordinary quake gets a neutral read (temperature over land, sst
 * painting the surrounding ocean). Deliberately excludes humidity/rain/gust/CAPE
 * — meteorology over a quake reads as nonsense on air.
 */
export interface QuakeMapPlan {
  cycle: string[];
  cycleMs: number;
}
export const QUAKE_TSUNAMI_PLAN: QuakeMapPlan = { cycle: ["sst", "wave"], cycleMs: 5500 };
export const QUAKE_LAND_PLAN: QuakeMapPlan = { cycle: ["temp", "sst"], cycleMs: 5500 };

/** The map plan for a quake shot — ocean story when tsunami-flagged, else neutral. */
export function quakeMapPlan(tsunami?: boolean): QuakeMapPlan {
  return tsunami ? QUAKE_TSUNAMI_PLAN : QUAKE_LAND_PLAN;
}

/**
 * Every display layer the director manages, all OFF. Each preset spreads this
 * and then turns on only what its shot needs.
 *
 * Why a shared off-base: Segment.patch is merged over /watch's *live*
 * ControlState (mergeControlState), so any layer a preset leaves unset keeps
 * whatever the previous cut left on. Without asserting the full set every cut,
 * "relevant per-kind toggles" silently become "sticky" — e.g. a storm's pressure
 * contours would bleed into the next quake shot. Spreading LAYERS_OFF guarantees
 * a clean slate; the preset's own keys below are the only layers that light up.
 *
 * Also asserts the dark default base map every cut: merges are over /watch's
 * *live* state, so pinning basemap here keeps a scene's non-default base (or one
 * hand-picked on a previous cut) from bleeding into the director's shots.
 *
 * Not included here (set explicitly per preset when relevant): activeVariable,
 * the camera-motion trio (autoSpin/spinSpeed/zoomDrift) and event filter
 * overrides (alertSeverityMin/seismicMinMag) — those aren't on/off layers.
 */
const LAYERS_OFF: Partial<ControlState> = {
  basemap: DEFAULT_BASEMAP_ID,
  showWind: false,
  showPressure: false,
  showContours: false,
  showCities: false,
  showRadar: false,
  showCables: false,
  showCableLabels: false,
  showFaults: false,
  showAlerts: false,
  showSeismic: false,
  showAircraft: false,
  showShips: false,
  showSatellites: false,
  showOrbits: false,
  showTrails: false,
  showTrackLabels: false,
};

/**
 * Layer preset per kind (everything except the camera, which the worker fills
 * in per subject). Each preset starts from LAYERS_OFF (see above) so it fully
 * owns the layer stack — no layer leaks in from the previous cut.
 */
export const PRESETS: Record<SegmentKind, Partial<ControlState>> = {
  // Per-shot camera "mode" so the globe is always alive but never wanders off a
  // subject. Two deterministic motions (in phase across /control and /watch via
  // spinEpoch):
  //   • GLOBAL shots (intro/ocean) SPIN — autoSpin rotates the whole world, which
  //     only reads right on a full-globe view.
  //   • EVERYTHING ELSE HOLDS on its subject (no spin — autoSpin advances the
  //     camera longitude, which would drift a framed region off-screen) and
  //     instead breathes with a slow zoomDrift push-in. Regional tours/weather
  //     get a gentle drift; detail events (storm/quake/flight/ship) a stronger one.
  intro: {
    ...LAYERS_OFF,
    activeVariable: "temp",
    showWind: true,
    // Synoptic H/L systems on the global spin read as "weather channel".
    showPressure: true,
    autoSpin: true,
    spinSpeed: 6,
    zoomDrift: 0,
  },
  // Global ocean spin — the active ocean variable (sst / wave) is filled in per
  // segment by the candidate builder. Land carries no data for these fields so
  // it stays neutral and the ocean reads as the coloured field.
  ocean: {
    ...LAYERS_OFF,
    showWind: true,
    autoSpin: true,
    spinSpeed: 6,
    zoomDrift: 0,
  },
  // Orbital constellation showcase — no weather map, just the dark globe with
  // the orbit rings, spun so the planes sweep round. Satellite group is set per
  // segment by the candidate builder.
  orbital: {
    ...LAYERS_OFF,
    activeVariable: null,
    showSatellites: true,
    showOrbits: true,
    showTrackLabels: true,
    autoSpin: true,
    spinSpeed: 5,
    zoomDrift: 0,
  },
  tour: {
    ...LAYERS_OFF,
    activeVariable: "temp",
    showWind: true,
    showCities: true,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.02,
  },
  weather: {
    ...LAYERS_OFF,
    activeVariable: "temp",
    showWind: true,
    showPressure: true,
    showContours: true,
    // RainViewer radar shows the actual precip inside the framed region.
    showRadar: true,
    showCities: true,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.02,
  },
  storm: {
    ...LAYERS_OFF,
    activeVariable: "gust",
    showWind: true,
    // Pressure = the storm's structure; radar = the precip core.
    showPressure: true,
    showRadar: true,
    showAlerts: true,
    // Drop the severity filter while framing a storm so the very alert the
    // director picked is guaranteed visible (the scene baseline may filter higher).
    alertSeverityMin: 0,
    showCities: true,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.045,
  },
  // A geology beat: no GFS weather field is relevant to a quake, so the shot
  // drops the scalar map entirely and reads as terrain — the dark default base
  // with colour-by-height elevation contour lines (250 m minor / 10 km major)
  // drawn over it, and cables + plate boundaries telling the sever-risk /
  // fault-origin story.
  quake: {
    ...LAYERS_OFF,
    // Dark default base (from LAYERS_OFF) + colour-by-height contour lines = the
    // geology look. No scalar field: activeVariable null, and useCutVariable no
    // longer cycles a weather field for quakes.
    activeVariable: null,
    showElevation: true,
    elevation: { ...DEFAULT_ELEVATION_SETTINGS, interval: 250, majorInterval: 10000 },
    showSeismic: true,
    // Show all quakes so the framed one isn't filtered out by the baseline min mag.
    seismicMinMag: 0,
    // Submarine cables: quakes are what sever them — the network frames the risk.
    showCables: true,
    // Tectonic plate boundaries: the fault the event sits on.
    showFaults: true,
    showCities: true,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.045,
  },
  flight: {
    ...LAYERS_OFF,
    activeVariable: "temp",
    showAircraft: true,
    showTrails: true,
    showTrackLabels: true,
    // Wind on: high-altitude flights ride the jet stream — that's the story.
    showWind: true,
    showCities: true,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.035,
  },
  ship: {
    ...LAYERS_OFF,
    // Sea state is the relevant field for vessels: swell height + surface wind.
    // Depends on wave ingest being live; falls back to a blank ocean if not.
    activeVariable: "wave",
    showShips: true,
    showTrails: true,
    showTrackLabels: true,
    showWind: true,
    showCities: true,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.035,
  },
};

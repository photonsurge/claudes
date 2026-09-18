/**
 * Curated establishing shots and per-kind layer presets for the auto-director.
 *
 * PRESETS define which layers each SegmentKind turns on; the worker merges a
 * preset with a camera to make a Segment.patch.
 */
import { DEFAULT_ELEVATION_SETTINGS, type ControlState } from "./control";
import { DEFAULT_BASEMAP_ID } from "./basemaps";
import type { SegmentKind } from "./director";

/** Global establishing shot — the intro/idle spin. */
export const GLOBAL_VIEW: { center: [number, number]; zoom: number } = {
  center: [0, 20],
  // A touch tighter than "fills the frame height" (3.0) so the planet still reads
  // big and immersive on the world spins — the disk only just crops top/bottom,
  // which is the intended broadcast look for a spinning globe (not a full disk on
  // black). Pulled back from 3.6 so the poles aren't cut so hard.
  zoom: 3.2,
};

/** Ocean world spins — same full-frame world view as the intro. */
export const OCEAN_VIEW_ZOOM = 3.2;

/**
 * "Map types" a global world spin tours WHILE it rotates — so an establishing
 * spin showcases the channel's looks instead of holding one static field for its
 * whole hold. The client (useDirectorCut) steps through these on the same
 * spinEpoch clock as the spin, so /control and /watch switch in lockstep with no
 * extra socket traffic, and the on-air label follows the map type.
 *
 * Each entry is a full look (scalar field + overlay toggles) folded over the
 * shot's preset — so it must own every toggle it varies (LAYERS_OFF gives the
 * clean base; the intro/ocean presets set wind/pressure). `needs` gates a type on
 * live data actually being available (aurora/satimg bake separately; ocean fields
 * may not be ingested) so a spin never lands on a blank map.
 *
 * Crucially, "clean base" isn't guaranteed: an operator's per-kind look
 * (DirectorConfig.kindLooks / overlayOverrides) can bake showAurora/showSatImg
 * true into the segment's baseline patch before any step ever folds over it (see
 * `make()` in worker/src/director/candidates.ts). Every entry here therefore sets
 * showAurora/showSatImg explicitly (true where it's the point of the look, false
 * everywhere else) rather than relying on LAYERS_OFF — otherwise an operator
 * enabling satellite imagery for a kind strands it on through every OTHER look in
 * that kind's tour too (e.g. rain/temp cuts rendering under a satellite overlay).
 */
export type MapTypeNeed =
  | { kind: "variable"; id: string } // scalar field must be present in the manifest
  | { kind: "aurora" } // the SWPC OVATION frame must be baked
  | { kind: "satimg" }; // at least one geostationary frame must be baked

export interface GlobalMapType {
  /** Stable id (for keys/debug). */
  id: string;
  /** On-air title while this look is up (e.g. "Aurora & Space Weather"). */
  title: string;
  /** On-air subtitle. */
  subtitle: string;
  /** The look: ControlState fields folded over the spin preset. Owns what it varies. */
  patch: Partial<ControlState>;
  /** Live-data dependency; the client drops a type whose feed has no frame yet. */
  needs?: MapTypeNeed;
}

/**
 * The world spin's tour: the core GFS fields plus the new "map types" (aurora,
 * live satellite imagery). Opens on temperature (index 0) so the establishing
 * shot always leads on the hero field, then works outward. No ocean fields here —
 * those belong to the ocean spin's own tour below.
 *
 * Shared by BOTH the `intro` opener and the recurring `global` spin (see
 * globalMapTour) — they differ only in scheduling, not look. The name stays
 * INTRO_* for continuity with the opener that introduced it.
 */
export const INTRO_MAP_TYPES: GlobalMapType[] = [
  {
    id: "temp",
    title: "Global Temperature",
    subtitle: "Surface air temperature",
    patch: { activeVariable: "temp", showWind: true, showPressure: true, showAurora: false, showSatImg: false, showCables: false },
    needs: { kind: "variable", id: "temp" },
  },
  {
    id: "cloud",
    title: "Global Cloud Cover",
    subtitle: "Total cloud cover",
    patch: { activeVariable: "cloud", showWind: false, showPressure: false, showAurora: false, showSatImg: false, showCables: false },
    needs: { kind: "variable", id: "cloud" },
  },
  {
    id: "rain",
    title: "Global Precipitation",
    subtitle: "Rain & snow rate",
    patch: { activeVariable: "rain", showWind: false, showPressure: false, showAurora: false, showSatImg: false, showCables: false },
    needs: { kind: "variable", id: "rain" },
  },
  {
    id: "pressure",
    title: "Global Pressure",
    subtitle: "Mean sea-level pressure · isobars",
    // Colour field PLUS the isobar contour + H/L overlay reads as a real surface
    // pressure chart, unlike the other looks which keep showPressure off.
    patch: { activeVariable: "pressure", showWind: false, showPressure: true, showAurora: false, showSatImg: false, showCables: false },
    needs: { kind: "variable", id: "pressure" },
  },
  {
    id: "aurora",
    title: "Aurora & Space Weather",
    subtitle: "OVATION auroral oval · live Kp",
    // No scalar field: the aurora glow reads over the dark globe. Wind/pressure off.
    patch: { activeVariable: null, showWind: false, showPressure: false, showAurora: true, showSatImg: false, showCables: false },
    needs: { kind: "aurora" },
  },
  {
    id: "night",
    title: "Earth at Night",
    subtitle: "VIIRS city lights",
    // The Black Marble basemap IS the look — no scalar field or chrome, so the
    // lights read. Submarine cables stay lit here (and only here): a bare-black
    // Pacific stretch with no city lights nearby otherwise reads as a dead frame,
    // and the cable network gives open ocean something to look at. A static
    // local asset, so no `needs` gate. The next look's fold over the preset
    // (LAYERS_OFF pins basemap) reverts the base automatically.
    patch: { basemap: "night", activeVariable: null, showWind: false, showPressure: false, showAurora: false, showSatImg: false, showCables: true },
  },
  {
    id: "world",
    title: "World",
    subtitle: "Land & ocean",
    // The plain globe: no scalar field or overlay, just the land/ocean base and
    // cities from the intro preset — a breather between the data-heavy looks and
    // the satellite finale. Static local asset, so no `needs` gate.
    patch: { activeVariable: null, showWind: false, showPressure: false, showAurora: false, showSatImg: false, showCables: false },
  },
  {
    id: "satimg",
    title: "Satellite View",
    subtitle: "Live geostationary imagery",
    patch: { activeVariable: null, showWind: false, showPressure: false, showAurora: false, showSatImg: true, showCables: false },
    needs: { kind: "satimg" },
  },
];

/**
 * The ocean world spin's tour: the ingested ocean fields, toured within one spin
 * (replacing the old one-field-per-cut ocean shots). Surface wind stays on — it
 * reads well over sea-surface temperature and swell. Opens on SST.
 */
export const OCEAN_MAP_TYPES: GlobalMapType[] = [
  {
    id: "sst",
    title: "Ocean Temperature",
    subtitle: "Sea surface temperature",
    patch: { activeVariable: "sst", showWind: true, showAurora: false, showSatImg: false },
    needs: { kind: "variable", id: "sst" },
  },
  {
    id: "wave",
    title: "Ocean Swell",
    subtitle: "Significant wave height",
    patch: { activeVariable: "wave", showWind: true, showAurora: false, showSatImg: false },
    needs: { kind: "variable", id: "wave" },
  },
  {
    id: "salinity",
    title: "Ocean Salinity",
    subtitle: "Sea surface salinity",
    patch: { activeVariable: "salinity", showWind: true, showAurora: false, showSatImg: false },
    needs: { kind: "variable", id: "salinity" },
  },
];

/**
 * The terrain looks a `quake` shot tours WHILE it holds on the epicentre — so a
 * seismic beat isn't one static map for its whole hold. No GFS weather field is
 * relevant to a quake (meteorology over a fault reads as nonsense), so every look
 * is geophysical: elevation contours, shaded relief, then city lights. Satellite
 * imagery is deliberately excluded — real-world orbital imagery over an epicentre
 * reads as a stock photo, not a geophysical instrument view. The epicentre rings +
 * plate boundaries + submarine cables + cities all come from the quake PRESET and
 * stay lit under every look; each type here only swaps the base map + contour
 * rendering. Opens on the contour look (it matches the preset, so the first frame
 * is stable before the client's rotation kicks in). Unlike the intro/ocean spins
 * these do NOT relabel the on-air card — the earthquake headline (magnitude/place)
 * stays put; only the map underneath changes.
 */
export const QUAKE_MAP_TYPES: GlobalMapType[] = [
  {
    id: "contours",
    title: "Elevation Contours",
    subtitle: "Terrain height · colour-by-height isolines",
    // Dark base + colour-by-height contour lines (intervals come from the preset).
    patch: { basemap: DEFAULT_BASEMAP_ID, activeVariable: null, showElevation: true, showAurora: false, showSatImg: false },
    needs: { kind: "variable", id: "elevation" },
  },
  {
    id: "relief",
    title: "Shaded Relief",
    subtitle: "ETOPO hypsometric terrain",
    // Colour-by-height relief FILL (ETOPO 2022) with the contour lines drawn over.
    patch: { basemap: "relief", activeVariable: null, showElevation: true, showAurora: false, showSatImg: false },
    needs: { kind: "variable", id: "elevation" },
  },
  {
    id: "night",
    title: "City Lights",
    subtitle: "Population footprint at night",
    // Black Marble around the epicentre — the lights read as WHO is nearby (the
    // population exposure), the geophysical counterpart to the terrain looks.
    patch: { basemap: "night", activeVariable: null, showElevation: false, showAurora: false, showSatImg: false },
  },
];

/**
 * The map-type tour for a segment kind, or null for kinds that don't tour (they
 * either hold one field or run a curated per-event plan). Global spins (intro/
 * global/ocean) tour their world looks; the `quake` event shot tours terrain looks while
 * it holds on the epicentre. Shared by the worker (opening field) and the client
 * (the within-shot rotation + relabel gating).
 *
 * `enabledIds` (from DirectorConfig.mapTypes[kind]) subtractively filters the
 * catalog to the operator-enabled looks — omitted/empty means "all enabled"
 * (today's behaviour). If the filter would leave zero looks, falls back to the
 * full catalog rather than airing a dead tour.
 */
export function globalMapTour(kind: SegmentKind, enabledIds?: string[]): GlobalMapType[] | null {
  // `intro` (the one-time opener) and `global` (the recurring world spin) share
  // the same world map-type tour — the only difference is scheduling, not look.
  const full =
    kind === "intro" || kind === "global"
      ? INTRO_MAP_TYPES
      : kind === "ocean"
        ? OCEAN_MAP_TYPES
        : kind === "quake"
          ? QUAKE_MAP_TYPES
          : null;
  if (!full) return null;
  if (!enabledIds || enabledIds.length === 0) return full;
  const filtered = full.filter((t) => enabledIds.includes(t.id));
  return filtered.length ? filtered : full;
}

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
   * globe. Hand-set for the low orbits, where the shell hugs the planet and the
   * framing is really framing the GLOBE; higher shells set `shellKm` instead and
   * let the geometry pick. Falls back to ORBITAL_VIEW_ZOOM when neither is set.
   */
  zoom?: number;
  /**
   * Orbit altitude to frame, in km — the constellation's shell, not a look. The
   * camera pulls back until a ring that size fits the broadcast frame, which for
   * medium and high orbits is the only thing that matters: a geostationary ring
   * is 6.6 Earth radii across, so a zoom chosen by eye for the planet leaves the
   * whole constellation off screen. Wins over `zoom` when both are set.
   */
  shellKm?: number;
  /**
   * Orbital inclination of the constellation, in degrees — how tall the shell
   * stands on screen. A geostationary belt lies flat (0°) and only has to fit the
   * frame's width; a 55° navigation shell is as tall as it is wide, so the frame's
   * SHORT side is what bounds it. Defaults to a flat belt.
   */
  inclDeg?: number;
}

/** Earth radius in metres, as deck's GlobeViewport measures altitude against. */
const EARTH_RADIUS_M = 6370972;
/** deck's globe is a sphere of this many common-space units. */
const GLOBE_UNITS = 256;
/** The broadcast frame orbital framing is calibrated against. */
const FRAME_WIDTH_PX = 1920;
const FRAME_HEIGHT_PX = 1080;
/**
 * How much of the frame a framed orbit shell spans. 0.78 keeps the whole shell on
 * screen with the planet still reading as a planet — the limbs pass behind the
 * on-air side columns, as the globe itself does on the low-orbit shots, and the
 * arc through the middle is clear.
 */
const SHELL_FILL = 0.78;

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * How tall a shell of inclination `incl` stands on screen, as a fraction of its
 * width, seen from camera latitude `lat`.
 *
 * The orbit is a circle of radius r; its projection is an ellipse as wide as the
 * circle whatever the inclination, but its HEIGHT depends on how much of the
 * orbital plane tips toward the viewer. The polar tilt contributes sin(incl)·
 * cos(lat) and looking down from a northern camera contributes sin(lat) — a ring
 * can never project taller than it is wide, hence the clamp.
 */
function shellHeightRatio(incl: number, lat: number): number {
  return Math.min(1, Math.sin(rad(incl)) * Math.cos(rad(lat)) + Math.abs(Math.sin(rad(lat))));
}

/**
 * GlobeView zoom at which an orbit shell of `altKm` fits SHELL_FILL of the
 * broadcast frame — its width, and for an inclined shell its height too.
 *
 * deck projects the globe as a sphere of GLOBE_UNITS scaled by 2^zoom / (π·cos
 * lat), and a shell at altitude A has radius (A/R + 1) times the planet's, so the
 * shell's on-screen size falls out of the zoom alone. Checked against deck's own
 * GlobeViewport: within ~2% of the projected ring at every medium and high orbit.
 */
export function orbitalZoomForShell(
  altKm: number,
  inclDeg = 0,
  latitude = GLOBAL_VIEW.center[1],
): number {
  const shells = (altKm * 1000) / EARTH_RADIUS_M + 1;
  // The widest the shell may draw, in pixels: the frame's width, and its height
  // divided by how much of that width the shell stands up into.
  const heightRatio = shellHeightRatio(inclDeg, latitude);
  const widthPx = Math.min(
    SHELL_FILL * FRAME_WIDTH_PX,
    (SHELL_FILL * FRAME_HEIGHT_PX) / Math.max(heightRatio, 0.01),
  );
  const cosLat = Math.cos(rad(latitude));
  return Math.log2((widthPx * Math.PI * cosLat) / (2 * shells * GLOBE_UNITS));
}

/** The camera zoom an orbital shot airs at: framed shell, else hand-set, else default. */
export function orbitalViewZoom(view: OrbitalView): number {
  if (view.shellKm !== undefined) return orbitalZoomForShell(view.shellKm, view.inclDeg ?? 0);
  return view.zoom ?? ORBITAL_VIEW_ZOOM;
}

export const ORBITAL_VIEWS: OrbitalView[] = [
  // Low-Earth-orbit showcases — close zoom so the shell hugs the globe.
  { group: "stations", title: "Space Stations", subtitle: "ISS & crewed platforms", zoom: 3.2 },
  { group: "visual", title: "Brightest Satellites", subtitle: "Visible to the naked eye", zoom: 2.6 },
  { group: "starlink", title: "Starlink", subtitle: "Low-Earth-orbit internet constellation", zoom: 3.0 },
  { group: "resource", title: "Earth Observation", subtitle: "Land-imaging satellites", zoom: 3.0 },
  { group: "science", title: "Science Missions", subtitle: "Hubble & orbital observatories", zoom: 3.0 },
  { group: "sarsat", title: "Search & Rescue", subtitle: "COSPAS-SARSAT distress-beacon relay", zoom: 3.0 },
  { group: "dmc", title: "Disaster Monitoring", subtitle: "Rapid-revisit imaging constellation", zoom: 3.0 },
  { group: "engineering", title: "Tech Demonstrators", subtitle: "Experimental & engineering satellites", zoom: 3.0 },
  // Medium/geostationary showcases — framed by their shell, not by eye. The
  // hand-set zooms these carried framed the PLANET, which left a geostationary
  // belt (2,150px across a 1,920px frame) mostly outside the frame and the
  // geostationary members of the mixed weather group entirely off it.
  // (The geostationary members are what the framing has to fit; the polar
  // weather birds ride close to the globe inside it.)
  { group: "weather", title: "Weather Satellites", subtitle: "Polar & geostationary", shellKm: 35786, inclDeg: 0 },
  { group: "gps-ops", title: "GPS Constellation", subtitle: "Navigation · medium Earth orbit", shellKm: 20200, inclDeg: 55 },
  { group: "galileo", title: "Galileo", subtitle: "European navigation constellation", shellKm: 23222, inclDeg: 56 },
  { group: "tdrss", title: "TDRS Relay Network", subtitle: "NASA's data-relay satellites", shellKm: 35786, inclDeg: 7 },
  { group: "goes", title: "GOES Constellation", subtitle: "Geostationary weather watch", shellKm: 35786, inclDeg: 0 },
  { group: "geo", title: "Geostationary Fleet", subtitle: "Communications & broadcast satellites", shellKm: 35786, inclDeg: 0 },
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
 * the camera-motion fields (autoSpin/spinSpeed/zoomDrift/orbitDrift) and event
 * filter overrides (alertSeverityMin/seismicMinMag) — those aren't on/off layers.
 */
export const LAYERS_OFF: Partial<ControlState> = {
  basemap: DEFAULT_BASEMAP_ID,
  showWind: false,
  showPressure: false,
  showContours: false,
  showElevation: false,
  showCities: false,
  showRadar: false,
  showCables: false,
  showCableLabels: false,
  showFaults: false,
  // The "map type" overlays: off by default so a spin's aurora/satellite look
  // doesn't stick into the next map step (or a scene's into a director shot).
  showAurora: false,
  showSatImg: false,
  showAlerts: false,
  showSeismic: false,
  showAircraft: false,
  showShips: false,
  showSatellites: false,
  showOrbits: false,
  showTrails: false,
  showTrackLabels: false,
  showFires: false,
  showVolcanoes: false,
  showMagneticField: false,
};

/**
 * The fixed set of boolean layer toggles a PRESET can turn on — every key of
 * LAYERS_OFF except `basemap` (a string, owned by the map-type tour, not an
 * overlay). This is the allow-list operator-configurable overlay overrides are
 * restricted to (see DirectorConfig.overlayOverrides) — never camera,
 * `activeVariable`, `basemap`, or `elevation`'s numeric settings.
 */
export const OVERLAY_KEYS = Object.keys(LAYERS_OFF).filter(
  (k) => k !== "basemap",
) as (keyof ControlState)[];

/**
 * Layer preset per kind (everything except the camera, which the worker fills
 * in per subject). Each preset starts from LAYERS_OFF (see above) so it fully
 * owns the layer stack — no layer leaks in from the previous cut.
 */
export const PRESETS: Record<SegmentKind, Partial<ControlState>> = {
  // Per-shot camera "mode" so the globe is always alive but never wanders off a
  // subject. Three deterministic motions (in phase across /control and /watch via
  // spinEpoch):
  //   • GLOBAL shots (intro/global/ocean) SPIN — autoSpin rotates the whole world,
  //     which only reads right on a full-globe view.
  //   • FRAMED AREA shots (country) ORBIT — orbitDrift circles the
  //     framed centre slowly so the wide area shot moves without the subject
  //     leaving frame (autoSpin's unbounded longitude advance would).
  //   • DETAIL events (storm/quake/flight/ship) HOLD on the subject and breathe
  //     with a stronger zoomDrift push-in only.
  // All framed shots also carry a gentle zoomDrift push-in on top of the above.
  intro: {
    ...LAYERS_OFF,
    activeVariable: "temp",
    showWind: true,
    // Synoptic H/L systems on the global spin read as "weather channel".
    showPressure: true,
    // Cities + labels on every mode; the progressive zoom reveal keeps a
    // whole-globe spin to just the major cities so it never turns to text soup.
    showCities: true,
    autoSpin: true,
    spinSpeed: 3,
    zoomDrift: 0,
  },
  // The recurring world spin — identical layer stack to the intro opener (both
  // tour INTRO_MAP_TYPES); the only difference is scheduling (intro airs once at
  // session start, global recurs as ordinary global filler).
  global: {
    ...LAYERS_OFF,
    activeVariable: "temp",
    showWind: true,
    showPressure: true,
    showCities: true,
    autoSpin: true,
    spinSpeed: 3,
    zoomDrift: 0,
  },
  // Global ocean spin — the active ocean variable (sst / wave) is filled in per
  // segment by the candidate builder. Land carries no data for these fields so
  // it stays neutral and the ocean reads as the coloured field.
  ocean: {
    ...LAYERS_OFF,
    showWind: true,
    showCities: true,
    autoSpin: true,
    spinSpeed: 3,
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
    showCities: true,
    autoSpin: true,
    spinSpeed: 2.5,
    zoomDrift: 0,
  },
  // A favourite-country spotlight reads as the national weather check: synoptic
  // pressure + live radar + any active warnings over the framed country, with the
  // ambient field cycle (temp → humidity → rain → …) running client-side like a
  // tour. Warnings drop the severity floor so the country's real alert picture
  // shows, not just the headline-grade ones the scene baseline may filter to.
  country: {
    ...LAYERS_OFF,
    activeVariable: "temp",
    showWind: true,
    showPressure: true,
    showRadar: true,
    showAlerts: true,
    alertSeverityMin: 0,
    showCities: true,
    showVolcanoes: true,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.025,
    // Circle the framed country slowly — a national-weather look that moves.
    orbitDrift: 5,
  },
  // A region ("area") spotlight is the sub-national / multi-country cousin of the
  // country shot — identical national-weather read (pressure + radar + warnings +
  // the ambient field cycle), just framed on a Region-catalog area instead of a
  // single country. Same preset so the two modes look the same on air.
  region: {
    ...LAYERS_OFF,
    activeVariable: "temp",
    showWind: true,
    showPressure: true,
    showRadar: true,
    showAlerts: true,
    alertSeverityMin: 0,
    showCities: true,
    showVolcanoes: true,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0.025,
    orbitDrift: 5,
  },
  // Sandbox-only kind: /sandbox applies the operator's own live camera directly
  // and never runs the director, so this preset is never applied — the entry
  // only satisfies the exhaustive Record<SegmentKind, …>.
  point: {},
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
  // Same geology read as the quake preset below (no weather field is relevant
  // to an eruption) plus the volcano overlay itself so the erupting/unrest
  // marker the director picked is actually visible on screen.
  volcano: {
    ...LAYERS_OFF,
    activeVariable: null,
    showElevation: true,
    elevation: { ...DEFAULT_ELEVATION_SETTINGS, interval: 250, majorInterval: 10000 },
    showVolcanoes: true,
    // Volcanoes cluster along subduction zones — the plate-boundary line tells
    // the "why here" story, same reasoning as the quake preset's showFaults.
    showFaults: true,
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
    // geology look. No scalar field: activeVariable null, and useDirectorCut has
    // no map-step cycle for quakes (they read as static terrain).
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
  // An ad interstitial covers the globe entirely with a full-frame card, so its
  // preset doesn't matter visually — everything off keeps the hidden globe cheap
  // and stops the previous shot's layers bleeding in behind the ad.
  ad: {
    ...LAYERS_OFF,
    activeVariable: null,
    autoSpin: false,
    spinSpeed: 0,
    zoomDrift: 0,
  },
};

/**
 * Event-marker overlays the worker layers onto a `global` spin that's carrying a
 * round-up (see `summaryCandidates` in worker/src/director/candidates.ts) — so
 * the seismic / alert / volcano markers behind the day's story are actually lit
 * while the round-up tours its hotspots. Severity/magnitude floors are dropped
 * (same as storm/quake/country) so every event the narration summarizes shows,
 * not just the headline-grade ones the scene baseline may filter to. Folded onto
 * the plain `global` preset via the candidate's `extra` patch, so a round-up
 * spin reads as the world spin PLUS the events it's narrating.
 */
export const ROUNDUP_MARKERS: Partial<ControlState> = {
  showSeismic: true,
  seismicMinMag: 0,
  showAlerts: true,
  alertSeverityMin: 0,
  showVolcanoes: true,
};

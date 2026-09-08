"use client";

/**
 * deck.gl GlobeView weather globe. Renders a true sphere so the weather raster
 * and wind particles wrap correctly at every zoom (MapLibre's globe projection
 * can't bind deck layers — deck only syncs flat mercator). The basemap is deck
 * layers (dark = ocean + land; satellite = Blue-Marble bitmap), and country
 * borders are a stroke-only layer drawn ABOVE the weather so they stay crisp.
 *
 * Must be dynamically imported with { ssr: false } — needs DOM + WebGL.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Deck, _GlobeView as GlobeView } from "@deck.gl/core";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import { loadTexture, preloadTextures, type LoadedTexture } from "../lib/textures";
import { isObsRender, setRendererInfo } from "../lib/broadcast-render";
import { useCrossfadeVariable } from "../lib/crossfade";
import { textureUrlFor } from "./layers/props";
import { basemapLayers, countriesLayer, hexToRgb, TILE_MIN_ZOOM } from "./layers/basemap";
import {
  scalarRasterLayers,
  vectorParticleLayers,
  windBarbLayers,
  pressureLayers,
  elevationLayers,
  elevationReliefLayer,
  cityLayer,
  type TextureResolver,
} from "./layers";
import { resolveEntries, activeNestSignature, type ResolverCamera } from "./layers/resolve";
import type { City } from "../lib/cities";
import { tracksLayer, orbitLayer, trailsLayer, filterTrails, trackLabelData, type TrackHighlight } from "./layers/tracks";
import { cityLabelMinZoom, cityDetail } from "../lib/cities";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { alertsLayer, onAirPulseLayers } from "./layers/alerts";
import { countryFeatureFor, countriesInBbox, countryGlowLayers } from "./layers/countryGlow";
import { seismicLayer } from "./layers/seismic";
import { seismographStationLayers, seismoKeyOf, seismoShortName } from "./layers/seismograph-stations";
import { graticuleLayer } from "./layers/graticule";
import { sourceDebugLayers } from "./layers/sourceDebug";
import { cableLayers, cableNameLabels } from "./layers/cables";
import { faultLayers } from "./layers/faults";
import { auroraLayers } from "./layers/aurora";
import { satimgLayers } from "./layers/satimg";
import { fireLayers } from "./layers/fires";
import { volcanoLayers, volcanoPosition, volcanoColor } from "./layers/volcanoes";
import { geomagLayers } from "./layers/geomag";
import { nightLayer } from "./layers/nightside";
import { subsolarPoint } from "../lib/sun";
import { discFromProject, type Disc } from "../lib/globe-geom";
import GlobeAtmosphere from "./GlobeAtmosphere";
import GlobeLabels, { type OverlayLabel } from "./GlobeLabels";
import type { Track, Quake } from "../lib/tracks/types";
import type { SeismoStationReading } from "../lib/seismo/types";
import type { TideStationReading } from "../lib/tides/types";
import { tideStationLayers, tideKeyOf, tideShortName } from "./layers/tide-stations";
import { stationMarkerLayers } from "./layers/monitor-stations";
import type { TrackPath } from "../lib/tracks/client";
import type { OrbitSegment } from "../lib/tracks/orbit";
import { orbitAmpCap } from "../lib/orbit-frame";
import {
  idleBreatheActive,
  idleMotionActive,
  idleMotionOffsets,
  idleOrbitActive,
  MAX_PUSH_IN,
} from "../lib/idle-motion";
import type { AlertFeature } from "../lib/alerts";
import { alertFocusKey, type AlertFocus } from "../lib/alert-cycle";
import type { Segment } from "@photonsurge/shared/director";
import { quakeToSegment, alertFeatureToSegment, volcanoToSegment } from "../lib/select-segment";
import type { CableOverlay } from "../lib/cables-overlay";
import type { Fault } from "@photonsurge/shared/faults/types";
import type { AuroraOverlay } from "../lib/aurora-overlay";
import type { SatImgOverlay } from "../lib/satimg-overlay";
import type { Fire } from "@photonsurge/shared/fires/types";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { GeomagOverlay } from "../lib/geomag-overlay";
import { HeartbeatIcon, VolcanoIcon, WaveIcon, MonitorPinIcon } from "./broadcast/icons";

export interface GlobeHandle {
  flyTo: (center: [number, number], zoom?: number) => void;
  fitBounds: (bbox: [number, number, number, number]) => void;
}

export interface GlobeProps {
  state: ControlState;
  manifest: WeatherManifest | null;
  cities: City[];
  /** Live overlay tracks (satellites/aircraft/ships). */
  tracks?: Track[];
  /** Satellite orbit rings. */
  orbits?: OrbitSegment[];
  /** Per-track recent routes (aircraft/ships) for the trails overlay. */
  trails?: TrackPath[];
  /** Active weather-alert polygons. */
  alerts?: AlertFeature[];
  /** The hazard cycle's current step — lights one hazard type and ghosts the
   *  rest (see lib/alert-cycle). Null draws every warning lit, as before. */
  alertFocus?: AlertFocus | null;
  /** Recent earthquakes (USGS). */
  quakes?: Quake[];
  /** Worker-cached live seismograph stations near what's on air. */
  seismoStations?: SeismoStationReading[];
  /** Which of `seismoStations` is currently "on air" in the SEISMIC MONITOR panel. */
  seismoActive?: SeismoStationReading | null;
  /** Worker-cached tide gauges near what's on air. */
  tideStations?: TideStationReading[];
  /** Which of `tideStations` is currently "on air" in the TSUNAMI GAUGE panel. */
  tideActive?: TideStationReading | null;
  /** [lng,lat] of the on-air point the WIND/PRESSURE/WAVE "LOCAL MONITOR"
   *  cards are reading, or null to hide the marker (no segment, no data, or
   *  the segment already has its own globe marker — see WatchSurface). */
  weatherPointCenter?: [number, number] | null;
  /** Display name for `weatherPointCenter` (the on-air segment's title). */
  weatherPointLabel?: string | null;
  /** Submarine cables + landing stations. */
  cables?: CableOverlay;
  faults?: Fault[];
  /** Latest baked aurora frame + decoded texture (NOAA SWPC OVATION), or null. */
  aurora?: AuroraOverlay | null;
  /** Latest baked geostationary satellite-imagery frames (Himawari-9 …), or null. */
  satimg?: SatImgOverlay | null;
  /** Worker-cached active fires (NASA FIRMS). */
  fires?: Fire[];
  /** Worker-cached active volcanoes (NASA EONET). */
  volcanoes?: Volcano[];
  /** Baked geomagnetic-field frame + decoded texture (IGRF total intensity), or null. */
  geomag?: GeomagOverlay | null;
  interactive?: boolean;
  onCameraChange?: (center: [number, number], zoom: number) => void;
  /** [lng,lat] of the active event to pulse-highlight, or null/undefined for none. */
  pulseAt?: [number, number] | null;
  /** ISO-3166 alpha-2 of the on-air country spotlight to glow-highlight, or null. */
  glowCountryIso?: string | null;
  /** Framed [west,south,east,north] box of a wide on-air shot with no single
   *  subject (e.g. a round-up stop) — every country boundary overlapping it
   *  glows, instead of a single spotlighted one. Mutually exclusive with
   *  glowCountryIso in practice (a segment glows either a single country or a
   *  whole framed area, never both). */
  glowRegionBbox?: [number, number, number, number] | null;
  /** On-air plane/ship to spotlight with a locator ring on the globe, or null. */
  highlightTrack?: TrackHighlight | null;
  /** Scene palette colours for map selection chrome and place labels. */
  mapHighlightColor?: string;
  mapLabelColor?: string;
  mapCapitalColor?: string;
  /**
   * Click-to-select an event/quake → its info-box segment (null when the click
   * misses every pickable event). Undefined disables selection entirely.
   */
  onSelect?: (segment: Segment | null) => void;
  /**
   * Click empty map (no pickable event under the cursor) → the picked lng/lat.
   * When set, a plain click reports its coordinate here instead of clearing the
   * selection; the caller turns it into a `weather` segment (see the sandbox's
   * point-pick). Undefined keeps the default "empty click clears" behaviour.
   */
  onPickPoint?: (lng: number, lat: number) => void;
}


type ViewState = { longitude: number; latitude: number; zoom: number } & Record<string, unknown>;

/** Flight duration bounds (ms). Actual duration scales with travel distance. */
const FLY_MIN = 2600;
const FLY_MAX = 7000;

/** Min ms between on-air pulse/glow re-commits (~30 Hz). */
const PULSE_FRAME_MS = 30;

// MAX_PUSH_IN (max extra zoom a detail-shot push-in may add) lives in
// idle-motion.ts — the idle breathe hands off from the push-in at that cap.

/** Seconds for one full slow orbit of a framed "area" shot (orbitDrift). */
const ORBIT_PERIOD_S = 48;
/** Seconds over which the orbit amplitude eases out from the anchor centre. */
const ORBIT_EASE_S = 8;

/** Smooth accel/decel so flights ease in and out instead of jerking. */
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Hover tooltip for a picked live track (aircraft/ship/satellite). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trackTooltip(o: any) {
  if (!o || (o.kind !== "aircraft" && o.kind !== "ship" && o.kind !== "satellite")) return null;
  const rows: string[] = [];
  rows.push(`<b>${o.flag ? `${o.flag} ` : ""}${o.name ?? o.code ?? ""}</b>`);
  const kindLabel = o.kind === "aircraft" ? "Aircraft" : o.kind === "ship" ? "Ship" : "Satellite";
  rows.push(o.code && o.code !== o.name ? `${kindLabel} · ${o.code}` : kindLabel);
  if (o.kind === "aircraft" && (o.acType || o.registration)) {
    rows.push([o.acType, o.registration].filter(Boolean).join(" · "));
  }
  if (o.kind === "aircraft" && o.operator) rows.push(o.operator);
  if (o.country) rows.push(o.country);
  if (o.kind === "aircraft") {
    if (o.altM != null) rows.push(`Alt ${Math.round(o.altM).toLocaleString()} m`);
    if (o.speedMS != null) rows.push(`Speed ${Math.round(o.speedMS * 1.94384)} kt`);
    if (o.verticalRateMS != null && Math.abs(o.verticalRateMS) > 0.5)
      rows.push(`${o.verticalRateMS > 0 ? "↑" : "↓"} ${Math.abs(Math.round(o.verticalRateMS * 196.85))} ft/min`);
    if (o.heading != null) rows.push(`Hdg ${Math.round(o.heading)}°`);
  } else if (o.kind === "ship") {
    if (o.sogKn != null) rows.push(`Speed ${o.sogKn.toFixed(1)} kn`);
    if (o.heading != null) rows.push(`Course ${Math.round(o.heading)}°`);
  } else {
    if (o.altM != null) rows.push(`Alt ${Math.round(o.altM / 1000).toLocaleString()} km`);
    if (o.speedMS != null) rows.push(`Speed ${(o.speedMS / 1000).toFixed(1)} km/s`);
  }
  return {
    html: rows.join("<br/>"),
    style: {
      background: "#0c111cE6",
      color: "#fff",
      fontSize: "12px",
      lineHeight: "1.45",
      padding: "6px 8px",
      borderRadius: "6px",
      border: "1px solid #1b2030",
    },
  };
}

/** Rough GlobeView zoom that frames a bbox. */
function zoomForBbox(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const span = Math.max(Math.abs(e - w), Math.abs(n - s)) || 1;
  return Math.max(2.5, Math.min(6, Math.log2(360 / span) + 1.9));
}

/** Wrap a longitude into −180..180 (ocean bboxes may run east past +180). */
const normLng = (lng: number): number => ((((lng + 180) % 360) + 360) % 360) - 180;

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { state, manifest, cities, tracks = [], orbits = [], trails = [], alerts = [], alertFocus = null, quakes = [], seismoStations = [], seismoActive = null, tideStations = [], tideActive = null, weatherPointCenter = null, weatherPointLabel = null, cables, faults, aurora, satimg, fires = [], volcanoes = [], geomag, interactive = true, onCameraChange, pulseAt, glowCountryIso, glowRegionBbox, highlightTrack, mapHighlightColor = "#4dc8ff", mapLabelColor = "#ffffff", mapCapitalColor = "#ffd700", onSelect, onPickPoint },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const deckRef = useRef<Deck<GlobeView[]> | null>(null);
  // Smoothly crossfades the scalar raster between successive activeVariable
  // values (manual picks, VAR_CYCLE, or the ocean depth-cycle scene) instead
  // of the instant mount/unmount a raw variable-id-keyed layer id would do.
  const variableFade = useCrossfadeVariable(state.activeVariable, 700);
  // The non-pulse layers, in four independently rebuilt groups that concatenate
  // in stack order (weather → events → cities → tracks) — see the group effects
  // below. Kept in a ref so the pulse rAF can re-commit them each frame.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layerGroupsRef = useRef<{ weather: any[]; events: any[]; cities: any[]; tracks: any[] }>({
    weather: [],
    events: [],
    cities: [],
    tracks: [],
  });
  const pulseAtRef = useRef<[number, number] | null>(pulseAt ?? null);
  const mapHighlightRgb = hexToRgb(mapHighlightColor);
  const mapLabelRgb = hexToRgb(mapLabelColor);
  const mapCapitalRgb = hexToRgb(mapCapitalColor);
  useEffect(() => {
    pulseAtRef.current = pulseAt ?? null;
  });
  // The resolved boundary feature(s) to glow (async — countries.geojson is
  // fetched/parsed once by countryGlow.ts, then cached), read by the pulse rAF
  // loop below so the glow keeps breathing every frame it's on air. A country
  // spotlight resolves to its single feature; a wide framed shot resolves to
  // every country overlapping the framed bbox.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const glowFeatureRef = useRef<any[]>([]);
  useEffect(() => {
    if (glowCountryIso) {
      let cancelled = false;
      countryFeatureFor(glowCountryIso).then((f) => {
        if (!cancelled) glowFeatureRef.current = f ? [f] : [];
      });
      return () => {
        cancelled = true;
      };
    }
    if (glowRegionBbox) {
      let cancelled = false;
      countriesInBbox(glowRegionBbox).then((fs) => {
        if (!cancelled) glowFeatureRef.current = fs;
      });
      return () => {
        cancelled = true;
      };
    }
    glowFeatureRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glowCountryIso, glowRegionBbox?.[0], glowRegionBbox?.[1], glowRegionBbox?.[2], glowRegionBbox?.[3]]);
  // Hover-pulse (control/interactive only): hovering an alert breathes its own
  // area, hovering a quake pings its epicentre — the same on-air highlight, so
  // the operator can "feel out" an event before clicking to pin its card. The
  // ref carries the anchor + which features to breathe (alerts pass their own
  // polygons; a quake passes none, so it's just the ring+dot ping). The state
  // (coords) only starts/stops the per-frame loop. A director cut takes over.
  const hoverPulseRef = useRef<{ at: [number, number]; features: AlertFeature[] } | null>(null);
  const [hoverPulse, setHoverPulse] = useState<[number, number] | null>(null);
  // Read by the per-frame pulse loop to find the on-air alert's own polygon, so
  // the highlight breathes the actual area rather than a free-floating reticle.
  const alertsRef = useRef(alerts);
  useEffect(() => {
    alertsRef.current = alerts;
  });
  const viewStateRef = useRef<ViewState>({
    longitude: state.camera.center[0],
    latitude: state.camera.center[1],
    zoom: state.camera.zoom,
  });
  const [loadedTextures, setLoadedTextures] = useState<Map<string, LoadedTexture>>(new Map());
  // Whether sharp XYZ tiles overlay the raster base (true once zoomed in).
  const [tilesActive, setTilesActive] = useState(state.camera.zoom >= TILE_MIN_ZOOM);

  // Bumps roughly once a minute so the day/night terminator advances with the
  // real sun without recomputing on every unrelated render.
  const [sunTick, setSunTick] = useState(0);
  useEffect(() => {
    if (!state.showDayNight) return;
    const t = setInterval(() => setSunTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [state.showDayNight]);

  // The globe's on-screen disc (centre + radius, CSS px) from the live deck
  // viewport — feeds the atmosphere/ring overlay. Reads only refs, so its
  // identity is stable across renders.
  const getDisc = useCallback((): (Disc & { lng: number }) | null => {
    const deck = deckRef.current;
    if (!deck) return null;
    const vp = deck.getViewports?.()[0];
    if (!vp) return null;
    const vs = viewStateRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const disc = discFromProject((c) => (vp as any).project(c), vs.longitude, vs.latitude);
    // Carry the sub-camera longitude so the pedestal ring can spin in lock-step
    // with the globe (its graticule ticks track globe longitude, not the screen).
    return disc ? { ...disc, lng: vs.longitude } : null;
  }, []);

  // Live deck viewport + sub-camera point for the HTML label overlay
  // (GlobeLabels). Read only refs, so their identity stays stable across renders.
  const getViewport = useCallback(() => deckRef.current?.getViewports?.()[0] ?? null, []);
  const getCamera = useCallback(
    () => ({ longitude: viewStateRef.current.longitude, latitude: viewStateRef.current.latitude }),
    [],
  );

  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  });

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const onPickPointRef = useRef(onPickPoint);
  useEffect(() => {
    onPickPointRef.current = onPickPoint;
  });

  // Live flag read inside the once-created deck callback below: true whenever a
  // deterministic camera motion (orbit spin, push-in zoom drift or the channel's
  // idle drift) owns the camera, so onViewStateChange doesn't feed those frames
  // back into React.
  const motionRef = useRef(
    state.autoSpin || !!state.zoomDrift || !!state.orbitDrift || idleMotionActive(state),
  );
  useEffect(() => {
    motionRef.current =
      state.autoSpin || !!state.zoomDrift || !!state.orbitDrift || idleMotionActive(state);
  });

  // Re-filter the (already-built) city dots in place as the live zoom changes,
  // without rebuilding the whole layer stack. `.clone()` only patches the
  // filterRange uniform the DataFilterExtension reads — the underlying data
  // buffer stays put. Still, this runs from the per-frame camera callbacks
  // (orbit spin, flights, drag), so it's gated on the zoom actually having
  // moved past the coarse bucket cities reveal at — a plain orbit spin holds
  // zoom constant and would otherwise re-commit the entire layer stack for no
  // visual change, every single frame.
  const lastCityZoomRef = useRef(-Infinity);
  const refreshCityZoom = (zoom: number) => {
    if (Math.abs(zoom - lastCityZoomRef.current) < 0.05) return;
    const group = layerGroupsRef.current.cities;
    const idx = group.findIndex((l) => l?.id === "cities-scatter");
    if (idx === -1) return;
    lastCityZoomRef.current = zoom;
    const layer = group[idx];
    const next = layer.clone({ filterRange: [0, zoom] });
    if (next === layer) return;
    layerGroupsRef.current.cities = [...group.slice(0, idx), next, ...group.slice(idx + 1)];
    commitLayers();
  };

  const applyViewState = (vs: ViewState) => {
    viewStateRef.current = vs;
    if (typeof vs.zoom === "number") {
      const want = vs.zoom >= TILE_MIN_ZOOM;
      setTilesActive((prev) => (prev === want ? prev : want));
      refreshCityZoom(vs.zoom);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deckRef.current?.setProps({ viewState: vs } as any);
  };

  // Single place that pushes layers to deck: the base layers plus, when an event
  // is on air, the animated highlight breathing over its own alert area.
  const commitLayers = () => {
    // A director cut owns the pulse (breathes the on-air alert's own polygon);
    // otherwise a quake hover drives a plain ring+dot ping at the epicentre —
    // pass no alert features so it never matches/breathes a nearby polygon.
    const cut = pulseAtRef.current;
    const hover = hoverPulseRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pulse: any[] = [];
    if (cut) pulse = onAirPulseLayers(alertsRef.current, cut, Date.now(), mapHighlightRgb);
    else if (hover) pulse = onAirPulseLayers(hover.features, hover.at, Date.now(), mapHighlightRgb);
    // A country spotlight breathes its boundary glow independently of (and
    // alongside) the point pulse above — the two kinds never overlap on air.
    // Outline only (no interior fill); each country's outline cycles through its
    // own flag colours, falling back to white where we have no flag palette.
    const glow = countryGlowLayers(glowFeatureRef.current, Date.now(), {
      fill: false,
      color: mapHighlightRgb,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any[];
    const g = layerGroupsRef.current;
    const layers = [...g.weather, ...g.events, ...g.cities, ...g.tracks, ...pulse, ...glow];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deckRef.current?.setProps({ layers } as any);
  };

  // True while a programmatic flight is animating. The auto-spin rAF loop yields
  // to it (otherwise the per-frame longitude write would fight the transition
  // and the camera would never reach the target).
  const flyingRef = useRef(false);
  const flyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flightRafRef = useRef<number | null>(null);

  // Raise the flying flag and arm a self-clearing safety net: a superseding
  // flyTo cancels the prior transition WITHOUT firing its onTransitionEnd, so we
  // must never rely on that alone to lower the flag (or the spin loop would
  // yield forever). Armed from THIS flight's duration — a fixed cap here fired
  // mid-flight on long director transitions (slider allows 12s) and the motion
  // loop snapped the camera to the target, skipping the end of the move. If the
  // net does fire, kill the flight rAF too so a stuck flight can't keep
  // fighting the motion loop for the camera.
  const beginFlight = (durationMs: number) => {
    flyingRef.current = true;
    if (flyTimerRef.current) clearTimeout(flyTimerRef.current);
    flyTimerRef.current = setTimeout(() => {
      flyingRef.current = false;
      if (flightRafRef.current !== null) {
        cancelAnimationFrame(flightRafRef.current);
        flightRafRef.current = null;
      }
    }, durationMs + 300);
  };

  // Persist wherever a programmatic transition lands so the operator's camera
  // state (and thus /watch) ends up at the target, not the pre-flight position.
  const commitCamera = () => {
    flyingRef.current = false;
    if (flyTimerRef.current) {
      clearTimeout(flyTimerRef.current);
      flyTimerRef.current = null;
    }
    const vs = viewStateRef.current;
    onCameraChangeRef.current?.([vs.longitude, vs.latitude], vs.zoom);
  };

  // Animate a camera flight ourselves with an rAF loop instead of deck's
  // viewState transitions — those only run when a controller is enabled, so on
  // the /watch globe (controller off) they were silently dropped and the camera
  // jumped. This drives both globes the same way: it rotates the world toward the
  // target (longitude/latitude move, which on a GlobeView turns the sphere) and
  // dips the zoom OUT mid-flight and back IN, so a far cut sweeps up over the
  // planet and settles. Endpoints are exact (sin(πt) = 0 at t=0 and t=1).
  const runFlight = (lng: number, lat: number, zoom: number, onDone?: () => void) => {
    if (flightRafRef.current !== null) cancelAnimationFrame(flightRafRef.current);
    const s = viewStateRef.current;
    const startLng = s.longitude;
    const startLat = s.latitude;
    const startZoom = s.zoom;
    // Seam-unwrap the target to the nearest turn so we cross ±180° the short way.
    let endLng = lng;
    while (endLng - startLng > 180) endLng -= 360;
    while (endLng - startLng < -180) endLng += 360;
    const dist = Math.hypot(endLng - startLng, lat - startLat);
    const dZoom = Math.abs(zoom - startZoom);
    // A director cut flies for a deliberate, operator-set time (state.cutTransitionMs,
    // stamped on each cut by the worker) so every transition holds the same slow,
    // cinematic pace. Manual operator flies (cutTransitionMs = 0) keep the default
    // distance-scaled duration.
    const fixed = state.cutTransitionMs ?? 0;
    const duration =
      fixed > 0 ? fixed : Math.min(FLY_MAX, Math.max(FLY_MIN, 1300 + dist * 28 + dZoom * 320));
    // Keep the mid-flight pull-back shallow so cuts stay near the surface and the
    // weather/eye-candy never shrinks to a distant dot before settling.
    const dip = Math.min(1.0, dist * 0.014); // zoom levels to pull back mid-flight
    beginFlight(duration);
    let t0 = 0;
    const step = (now: number) => {
      if (!t0) t0 = now;
      const t = Math.min(1, (now - t0) / duration);
      const e = easeInOutCubic(t);
      let longitude = startLng + (endLng - startLng) * e;
      longitude = ((((longitude + 180) % 360) + 360) % 360) - 180;
      const latitude = startLat + (lat - startLat) * e;
      const z = Math.max(0, startZoom + (zoom - startZoom) * e - dip * Math.sin(Math.PI * t));
      applyViewState({ longitude, latitude, zoom: z });
      if (t < 1) {
        flightRafRef.current = requestAnimationFrame(step);
      } else {
        flightRafRef.current = null;
        onDone?.();
      }
    };
    flightRafRef.current = requestAnimationFrame(step);
  };

  const flyToInternal = (lng: number, lat: number, zoom: number) => {
    // Tell /watch the destination once so a manual operator fly also moves it (it
    // runs its own flight to the same target). During director cuts /control's
    // onCameraChange is guarded, so this is a no-op there.
    onCameraChangeRef.current?.([lng, lat], zoom);
    runFlight(lng, lat, zoom, commitCamera);
  };

  useImperativeHandle(ref, () => ({
    flyTo: (center, zoom) =>
      flyToInternal(center[0], center[1], zoom ?? viewStateRef.current.zoom),
    fitBounds: (bbox) =>
      flyToInternal(normLng((bbox[0] + bbox[2]) / 2), (bbox[1] + bbox[3]) / 2, zoomForBbox(bbox)),
  }));

  // ── Deck init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || deckRef.current) return;
    const deck = new Deck<GlobeView[]>({
      canvas: canvasRef.current,
      // Inside an OBS browser source the canvas IS the broadcast raster (CEF
      // paints a fixed 1920×1080 and the encoder takes it verbatim), so a DPR
      // upscale would be wasted fill-rate on pixels nobody ever sees. Normal
      // browsers keep the crisp devicePixelRatio render.
      useDevicePixels: !isObsRender(),
      // On dual-GPU machines (and CEF, which honours the same context hint) ask
      // for the discrete adapter — a browser source quietly landing on the iGPU
      // or a software rasteriser is the classic "4 streams melt the box" cause.
      deviceProps: { webgl: { powerPreference: "high-performance" } },
      // Surface which device WebGL ACTUALLY came up on: RenderHealthBadge turns
      // it into the on-air SOFTWARE RENDER chip inside OBS, and the console line
      // is what you read via remote-debugging a headless encoder.
      onDeviceInitialized: (device) => {
        const { vendor, renderer } = device.info;
        setRendererInfo(vendor, renderer);
        console.info(`[globe] WebGL device: ${vendor} — ${renderer}`);
      },
      // `resolution` is the degree grid deck cuts flat polygons on before
      // projecting them onto the sphere — it defaults to 10°, whose chords sag
      // ~24km BELOW the surface at cell centre. The depth sphere basemap.ts
      // writes is a hand-rolled 6° grid, sagging only ~8.7km, so every polygon
      // fill (alert areas above all, now that the worker dissolves them into
      // country-sized shapes) sat UNDER the depth sphere and the globe occluded
      // its own overlay — reading as a flat sheet clipping through the planet.
      // At 2° the sag is ~1km: a polygon cut on a grid at least as fine as the
      // depth sphere's is always ABOVE it, so the fill drapes instead of sinks.
      // Same 2° that cables.ts great-circle-densifies its paths to, for the
      // same reason.
      views: [new GlobeView({ id: "globe", resolution: 2 })],
      controller: interactive,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      viewState: viewStateRef.current as any,
      layers: [],
      // Hover a plane/ship/satellite → metadata card (flag, code, alt, speed…).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getTooltip: ({ object }: any) => trackTooltip(object),
      // Hover an alert / quake (operator/control globe only) → the on-air
      // highlight: an alert breathes its own area, a quake pings its epicentre.
      // Only fire a state update when the hovered anchor actually changes, so a
      // mouse resting over an event doesn't re-render every frame.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onHover: (info: any) => {
        if (!interactive) return;
        const layerId: string = info?.layer?.id ?? "";
        const obj = info?.object;
        let next: { at: [number, number]; features: AlertFeature[] } | null = null;
        if (obj && layerId.startsWith("seismic")) {
          next = { at: [obj.lng, obj.lat], features: [] };
        } else if (obj && layerId.startsWith("alerts")) {
          const at = alertRepPoint(obj.geometry);
          if (at) next = { at, features: alertsRef.current };
        }
        const cur = hoverPulseRef.current;
        const same =
          cur && next ? cur.at[0] === next.at[0] && cur.at[1] === next.at[1] : cur === next;
        if (!same) {
          hoverPulseRef.current = next;
          setHoverPulse(next ? next.at : null);
        }
      },
      // Click an earthquake / alert polygon / volcano → its info-box segment (same card the
      // director shows on air). Clicking empty globe reports the picked lng/lat to
      // onPickPoint (sandbox → weather-point card) when wired, else clears the selection.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onClick: (info: any) => {
        const select = onSelectRef.current;
        const pick = onPickPointRef.current;
        const layerId: string = info?.layer?.id ?? "";
        if (info?.object && layerId.startsWith("seismic")) select?.(quakeToSegment(info.object));
        else if (info?.object && layerId.startsWith("alerts")) select?.(alertFeatureToSegment(info.object));
        else if (info?.object && layerId.startsWith("volcano")) select?.(volcanoToSegment(info.object));
        else {
          // deck gives `coordinate` when the pointer is over the globe surface;
          // it's undefined out in space, where a click should just clear.
          const coord = info?.coordinate;
          if (pick && Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1])) {
            pick(coord[0], coord[1]);
          } else {
            select?.(null);
          }
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onViewStateChange: ({ viewState, interactionState }: any) => {
        viewStateRef.current = viewState;
        // While a deterministic motion (spin/push-in) runs, the rAF loop owns the
        // camera. deck re-emits this callback for the loop's setProps; feeding
        // that back into React state would re-render/persist every frame
        // (infinite loop + poll storm), so bail — only react to user interaction.
        if (motionRef.current || flyingRef.current) return;
        const want = viewState.zoom >= TILE_MIN_ZOOM;
        setTilesActive((prev) => (prev === want ? prev : want));
        // During a programmatic transition (flyTo / fitBounds / follow) deck
        // owns the camera and interpolates internally. Re-setting the bare
        // interpolated viewState here would reset the transition's target to the
        // current frame and kill the animation a few pixels in — so only feed
        // back real user interaction. The final camera is captured by the
        // transition's onTransitionEnd instead.
        if (interactionState?.inTransition) return;
        deck.setProps({ viewState } as Parameters<typeof deck.setProps>[0]);
        refreshCityZoom(viewState.zoom);
        onCameraChangeRef.current?.([viewState.longitude, viewState.latitude], viewState.zoom);
      },
    });
    deckRef.current = deck;
    // Diagnostics hook for scripts/profile-watch.mjs (`--deck`): lets a CDP
    // session count the primitive layers deck draws per frame. Viewer-side
    // only; nothing reads it in the app.
    (window as unknown as { __godsDeck?: unknown }).__godsDeck = deck;
    return () => {
      deck.finalize();
      deckRef.current = null;
      delete (window as unknown as { __godsDeck?: unknown }).__godsDeck;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Follow external camera (/watch mirroring the director / operator) ──────
  const lastAnchorRef = useRef<{ lng: number; lat: number; zoom: number } | null>(null);
  useEffect(() => {
    // Only /watch follows. The operator (interactive) drives its own camera via
    // imperative flyTo/fitBounds, so it never chases state.camera here.
    if (interactive) return;
    const c = state.camera;
    // Act only when the TARGET anchor changes (a new cut / operator move) — NOT
    // when the live camera has merely drifted under the spin/push-in, or we'd
    // fly back to the anchor every time the variable cycle re-renders.
    const prev = lastAnchorRef.current;
    const sameAnchor =
      prev &&
      Math.abs(prev.lng - c.center[0]) < 1e-4 &&
      Math.abs(prev.lat - c.center[1]) < 1e-4 &&
      Math.abs(prev.zoom - c.zoom) < 1e-4;
    if (sameAnchor) return;
    lastAnchorRef.current = { lng: c.center[0], lat: c.center[1], zoom: c.zoom };

    // First mount: snap to the initial view rather than flying from [0,20].
    if (!prev) {
      applyViewState({ longitude: c.center[0], latitude: c.center[1], zoom: c.zoom });
      return;
    }

    const vs = viewStateRef.current;
    let lng = c.center[0];
    while (lng - vs.longitude > 180) lng -= 360;
    while (lng - vs.longitude < -180) lng += 360;
    const small = Math.abs(lng - vs.longitude) < 5 && Math.abs(vs.zoom - c.zoom) < 0.5;
    if (small) {
      // A live drag-follow tick — snap so dragging the operator feels live.
      applyViewState({ longitude: lng, latitude: c.center[1], zoom: c.zoom });
    } else {
      // A director cut / region preset — fly the same arc the operator sees.
      runFlight(c.center[0], c.center[1], c.zoom, commitCamera);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.camera, interactive]);

  // ── Auto-spin (DETERMINISTIC — every page stays in phase) ─────────────────
  // longitude = anchor + spinSpeed·(now − spinEpoch). The anchor (camera.center
  // [0]), spinSpeed and spinEpoch all live in control state, so /control and
  // /watch compute the SAME longitude from the same wall clock — a smooth 60 fps
  // spin with ZERO per-frame socket traffic, and the two globes stay locked
  // together (no follow/transition jitter). Runs on every page, not just the
  // operator. onViewStateChange bails while spinning, so this never hits React.
  useEffect(() => {
    const spinSpeed = state.autoSpin ? state.spinSpeed : 0;
    const zoomDrift = state.zoomDrift || 0;
    const orbitDrift = state.orbitDrift || 0;
    // Channel idle drift, per-movement gated so it COMPOSES with a director
    // hold: the orbit rides along with a push-in (only autoSpin / the
    // director's own orbit suppress it), the breathe only when nothing else
    // owns the zoom. Suppressed movements are zeroed here so the loop below
    // never double-drives an axis.
    const idle = idleMotionActive(state)
      ? {
          idleOrbit: idleOrbitActive(state) ? state.idleOrbit : 0,
          idleBreathe: idleBreatheActive(state) ? state.idleBreathe : 0,
          idlePeriodS: state.idlePeriodS,
        }
      : null;
    if (spinSpeed === 0 && zoomDrift === 0 && orbitDrift === 0 && !idle) return;
    // Anchor to the cut so motion is deterministic (same on /control and /watch).
    // WIDE shots spin (spinSpeed>0) around the anchor longitude; FRAMED AREA shots
    // orbit (orbitDrift>0) in a slow circle round the anchor; DETAIL shots push in
    // (zoomDrift>0) while staying dead-centred on anchorLng/anchorLat.
    const anchorLng = state.camera.center[0];
    const anchorLat = state.camera.center[1];
    const anchorZoom = state.camera.zoom;
    const epoch = state.spinEpoch || Date.now();
    // The orbit starts once the fly-in has settled and eases out from the anchor
    // (amplitude 0 → orbitDrift), so handing off from runFlight never pops. Divide
    // the lng offset by cos(lat) so the circle looks round, not squashed, at high
    // latitude (clamped so a near-polar shot can't blow the offset up).
    const flightSec = (state.cutTransitionMs || 0) / 1000;
    const lngScale = Math.max(Math.cos((anchorLat * Math.PI) / 180), 0.35);
    let raf = 0;
    const loop = () => {
      // A flyTo/fitBounds is animating — let it own the camera this frame.
      if (flyingRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const dt = (Date.now() - epoch) / 1000;
      // Creep closer, capped so a long hold doesn't bore through the surface.
      // A channel breathe OWNS the zoom instead: the push-in is skipped so the
      // in-and-back sway is visible from the first second of the hold (a
      // push-in needs ~27s to top out — longer than many director holds).
      const pushIn = idle && idle.idleBreathe > 0 ? 0 : zoomDrift;
      let zoom = anchorZoom + Math.min(pushIn * dt, MAX_PUSH_IN);
      let longitude = anchorLng + spinSpeed * dt;
      let latitude = anchorLat;
      if (idle) {
        // Idle drift (per-channel): slow orbit round the anchor and/or a
        // raised-cosine zoom breathe, deterministic in dt so /control and
        // /watch drift in phase. Pass the LIVE zoom (incl. any push-in) so the
        // orbit pan cap tightens as a detail shot creeps closer, exactly like
        // the director orbit below. Same fly-in grace, additive on both axes.
        const ot = Math.max(0, dt - flightSec);
        const o = idleMotionOffsets(idle, ot, { zoom, lat: anchorLat });
        longitude += o.dLng;
        latitude = Math.max(-85, Math.min(85, latitude + o.dLat));
        zoom += o.dZoom;
      }
      if (orbitDrift > 0) {
        const ot = Math.max(0, dt - flightSec); // time since the fly-in settled
        // Bound the pan to a safe slice of what's on screen at the LIVE zoom so the
        // framed subject can never drift out of frame (a fixed orbitDrift dragged
        // small-country shots off toward an edge). The cap tightens as the push-in
        // above zooms in, and depends on zoom alone — no canvas read — so /control
        // and /watch compute the same amplitude and stay phase-locked.
        const amp = Math.min(orbitDrift, orbitAmpCap(zoom)) * (1 - Math.exp(-ot / ORBIT_EASE_S));
        const theta = (2 * Math.PI * ot) / ORBIT_PERIOD_S;
        longitude += (amp * Math.cos(theta)) / lngScale;
        latitude += amp * Math.sin(theta);
        latitude = Math.max(-85, Math.min(85, latitude));
      }
      longitude = ((((longitude + 180) % 360) + 360) % 360) - 180; // wrap to −180..180
      applyViewState({ longitude, latitude, zoom });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.autoSpin,
    state.spinSpeed,
    state.zoomDrift,
    state.orbitDrift,
    state.idleMotion,
    state.idleOrbit,
    state.idleBreathe,
    state.idlePeriodS,
    state.cutTransitionMs,
    state.spinEpoch,
    state.camera,
  ]);

  // On the operator, freeze the camera to the current longitude when a spin
  // stops so it doesn't snap back to the anchor and the next spin starts here.
  const prevAutoSpin = useRef(state.autoSpin);
  useEffect(() => {
    if (prevAutoSpin.current && !state.autoSpin) {
      const vs = viewStateRef.current;
      onCameraChangeRef.current?.([vs.longitude, vs.latitude], vs.zoom);
    }
    prevAutoSpin.current = state.autoSpin;
  }, [state.autoSpin]);

  // Signature of the ACTIVE regional-nest set for the visible variables. Changes
  // only when a zoom threshold is crossed or the view centre enters/leaves a nest
  // bbox — so the preload + layer-rebuild effects below re-run when nests flip on
  // or off, but NOT on every camera tick (panning/zooming within the same set).
  const nestKey = manifest
    ? [
        state.activeVariable ? activeNestSignature(manifest.variables[state.activeVariable], state.camera) : "",
        state.showWind ? activeNestSignature(manifest.variables.wind, state.camera) : "",
      ].join(";")
    : "";

  // ── Texture loading for the active fhr ────────────────────────────────────
  useEffect(() => {
    if (!manifest) return;
    const urls = new Set<string>();
    const add = (u?: string) => {
      if (u) urls.add(u);
    };
    // Base + active-nest textures for the active variable and wind. resolveEntries
    // yields [base, ...activeNests]; each entry's `files` are already URLs.
    const camera: ResolverCamera = { center: state.camera.center, zoom: state.camera.zoom };
    const addEntries = (variableId: string) => {
      for (const e of resolveEntries(manifest.variables[variableId], camera)) add(e.files[String(state.fhr)]);
    };
    if (state.showWind) addEntries("wind");
    if (state.activeVariable) addEntries(state.activeVariable);
    if (state.showPressure) add(textureUrlFor(manifest, "pressure", state.fhr));
    // Elevation is static (baked at fhr 0), so always pull its single texture
    // regardless of the active forecast hour. Needed for the contour overlay AND
    // the "Relief" basemap.
    if (state.showElevation || state.basemap === "relief") add(textureUrlFor(manifest, "elevation", 0));

    let cancelled = false;
    [...urls].forEach((url) => {
      loadTexture(url)
        .then((tex) => {
          if (cancelled) return;
          setLoadedTextures((prev) => new Map(prev).set(url, tex));
        })
        .catch((err) => {
          if (!cancelled) console.warn(`[globe] texture load failed: ${url}`, err);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, state.fhr, state.activeVariable, state.showWind, state.showPressure, state.showElevation, state.basemap, nestKey]);

  // ── Keep EVERY weather map decoded in RAM (instant director cuts) ──────────
  // Warm the texture cache for all variables' global base maps at the active
  // fhr, not just the one on screen. A director cut — or a within-shot field
  // cycle — then switches instantly: the decoded TextureData is already in
  // memory, so there's no mid-broadcast network fetch (the "control feels slow
  // when directed" lag). The module cache holds the decoded texture, so this is
  // literally all the maps kept in RAM. Aurora/sat-imagery use their own loaders.
  useEffect(() => {
    if (!manifest) return;
    preloadTextures(Object.keys(manifest.variables).map((id) => textureUrlFor(manifest, id, state.fhr)));
  }, [manifest, state.fhr]);

  // ── Rebuild layers — four independent groups ──────────────────────────────
  // The stack is weather → events → cities → tracks. Each group has its own
  // effect + deps, so the 1 s track dead-reckon tick only rebuilds the track
  // layers: rebuilding EVERYTHING per tick re-diffed every layer and sublayer
  // (and, before props.ts cached bounds/palettes, re-meshed every raster and
  // re-baked every palette) roughly twice a second on air.

  // Group 1 — basemap, weather rasters/particles/contours, borders, reference
  // overlays (graticule, sat imagery, aurora, cables, faults).
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const resolve: TextureResolver = (url) => loadedTextures.get(url);

    // A full-globe weather raster (non-nest-only variable) seals the depth sphere
    // itself; a nest-only variable (radar) does not, so the basemap background must
    // stay the occluder. Detected by whether the active variable has a base texture
    // at this fhr.
    const weatherRaster = !!(
      manifest && state.activeVariable && textureUrlFor(manifest, state.activeVariable, state.fhr)
    );
    // The elevation texture backs both the "Relief" basemap and the contour
    // overlay. Either is a full-globe WeatherLayers surface that must SEAL the depth
    // sphere itself (relief raster at full or 0 opacity) — otherwise the basemap
    // occludes at the wrong depth and hides the contour lines. So any of them means
    // the basemap must NOT be the occluder.
    const elevationTex = !!(manifest && textureUrlFor(manifest, "elevation", 0));
    const reliefBasemap = state.basemap === "relief" && elevationTex;
    const contourOn = state.showElevation && elevationTex;
    // The geomag overlay is likewise a full-globe WeatherLayers RasterLayer (the
    // IGRF total-intensity field), so it needs to seal its own depth exactly like
    // the weather raster / relief — otherwise the basemap sphere depth-culls it
    // when it's the only overlay on.
    const geomagOn = !!(state.showMagneticField && geomag?.texture);
    const hasGlobalRaster = weatherRaster || reliefBasemap || contourOn || geomagOn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [...basemapLayers(state, tilesActive, hasGlobalRaster)];

    // Day/night terminator: shade the earth's night hemisphere from the real sun
    // position. Sits directly on the basemap, below the weather + overlays so
    // borders/cities/alerts stay bright on top. `sunTick` advances it over time.
    const subsolar = state.showDayNight ? subsolarPoint(new Date()) : null;
    if (subsolar) layers.push(nightLayer(subsolar));

    if (manifest) {
      // Nest-aware: the global base plus any regional high-res overlays active at
      // the current camera (finest on top). `nestKey` in the deps re-runs this
      // only when the active-nest set flips, not on every camera tick.
      const camera: ResolverCamera = { center: state.camera.center, zoom: state.camera.zoom };
      // Relief BASE: the shaded hypsometric map when the "Relief" basemap is picked
      // (full opacity). Otherwise, if contours are on with no weather raster to seal
      // the surface, drop an INVISIBLE (opacity 0) relief that writes depth only, so
      // the lines aren't culled by the basemap sphere. Either way it sits UNDER the
      // weather + contours.
      if (reliefBasemap) {
        const relief = elevationReliefLayer(manifest, resolve, { opacity: 1 });
        if (relief) layers.push(relief);
      } else if (contourOn && !weatherRaster) {
        const sealer = elevationReliefLayer(manifest, resolve, { opacity: 0 });
        if (sealer) layers.push(sealer);
      }
      if (state.activeVariable) {
        // Mid-crossfade: draw the outgoing variable fading out UNDER the
        // incoming one fading in (see useCrossfadeVariable) instead of the
        // instant hard cut a bare activeVariable switch would produce.
        if (variableFade.from && variableFade.progress < 1) {
          layers.push(
            ...scalarRasterLayers(manifest, variableFade.from, state.fhr, resolve, camera, {
              opacity: 0.7 * (1 - variableFade.progress),
            }),
          );
          layers.push(
            ...scalarRasterLayers(manifest, variableFade.to, state.fhr, resolve, camera, {
              opacity: 0.7 * variableFade.progress,
            }),
          );
        } else {
          layers.push(...scalarRasterLayers(manifest, state.activeVariable, state.fhr, resolve, camera));
        }
      }
      if (state.showPressure) layers.push(...pressureLayers(manifest, state.fhr, resolve));
      if (contourOn) {
        layers.push(
          ...elevationLayers(manifest, resolve, {
            colorMode: state.elevation.colorMode,
            color: state.elevation.color,
            width: state.elevation.width,
            opacity: state.elevation.opacity,
            interval: state.elevation.interval,
            majorInterval: state.elevation.majorInterval,
          }),
        );
      }
      if (state.showWind) {
        if (state.windMode === "barbs") {
          // Meteorological barbs of the same uv field. Only the colour follows
          // the operator's wind settings — the particle sliders don't apply.
          layers.push(...windBarbLayers(manifest, "wind", state.fhr, resolve, camera, { color: state.wind.color }));
        } else {
          layers.push(...vectorParticleLayers(manifest, "wind", state.fhr, resolve, camera, state.wind));
        }
      }
    }

    // Global geomagnetic-field intensity (IGRF) — a full-globe scalar field drawn
    // as the surface (under borders/cities/overlays), like the weather rasters.
    if (state.showMagneticField && geomag?.texture) {
      layers.push(...geomagLayers(geomag.meta, geomag.texture, state.magneticFieldOpacity));
    }

    // Country borders sit ABOVE the weather fill.
    layers.push(countriesLayer(state));

    // DEBUG: outline each active weather-map source's bbox + label, above the
    // borders so you can check which model renders where vs the coastline.
    if (state.showMapSource && manifest && state.activeVariable) {
      layers.push(
        ...sourceDebugLayers(manifest, state.activeVariable, {
          center: state.camera.center,
          zoom: state.camera.zoom,
        }),
      );
    }

    // Reference graticule (equator/tropics/polar circles + meridians) — drawn
    // above the borders as a geographic reference, below the live overlays.
    if (state.showGraticule) {
      layers.push(...graticuleLayer(state.graticuleColor, state.graticuleLabels));
    }

    // Geostationary satellite imagery — real cloud disk(s) draped above the
    // weather/wind, below the reference overlays so those stay crisp on top. Full-
    // globe PNG per bird (transparent off-disk); the far side is depth-occluded.
    if (state.showSatImg && satimg?.frames.length) {
      layers.push(...satimgLayers(satimg.frames, state.satImgFeeds));
    }

    // Aurora oval — a translucent glow above the weather/wind/borders but below
    // the vector reference overlays (cables/faults/alerts/cities/tracks) so those
    // stay crisp on top. Pre-baked PNG; the far-side oval is depth-occluded.
    if (state.showAurora && aurora?.texture) {
      layers.push(...auroraLayers(aurora.meta, aurora.texture, state.auroraOpacity));
    }

    // Submarine cables read as reference geography — above borders/weather,
    // below the live event overlays (alerts/quakes/cities/tracks).
    if (state.showCables && cables && cables.cables.length) {
      layers.push(...cableLayers(cables.cables, cables.landings));
    }

    // Tectonic plate boundaries read as reference geography — above borders/
    // weather, below the live event overlays (alerts/quakes/cities/tracks).
    if (state.showFaults && faults && faults.length) {
      layers.push(...faultLayers(faults));
    }

    layerGroupsRef.current.weather = layers;
    commitLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    manifest,
    loadedTextures,
    tilesActive,
    state.basemap,
    state.activeVariable,
    variableFade.from,
    variableFade.to,
    variableFade.progress,
    state.showPressure,
    state.showElevation,
    state.elevation,
    state.showWind,
    state.fhr,
    state.basemapColors,
    state.wind,
    state.windMode,
    state.showContours,
    state.showRadar,
    state.showCables,
    state.showCableLabels,
    state.showFaults,
    state.showAurora,
    state.auroraOpacity,
    state.showSatImg,
    state.satImgFeeds,
    state.showMagneticField,
    state.magneticFieldOpacity,
    state.showMapSource,
    state.showGraticule,
    state.graticuleColor,
    state.graticuleLabels,
    state.showDayNight,
    sunTick,
    cables,
    faults,
    aurora,
    satimg,
    geomag,
    nestKey,
  ]);

  // Group 2 — live events: alert areas, quakes, seismograph/tide stations, the
  // LOCAL MONITOR point, fires, volcanoes.
  useEffect(() => {
    if (!deckRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [];

    // Weather-alert polygons above borders, below cities/tracks. Kept mounted
    // (visibility toggled, not added/removed) so a director cut flipping
    // showAlerts doesn't force a cold re-tessellation of every polygon.
    if (alerts.length) layers.push(...alertsLayer(alerts, state.showAlerts, alertFocus));

    // Earthquakes above alerts, below cities/tracks.
    if (state.showSeismic && quakes.length) layers.push(...seismicLayer(quakes));

    // Live seismograph stations — the real instruments behind the SEISMIC
    // MONITOR trace, shown near an on-air quake/region so the map and panel agree.
    if (state.showSeismic && seismoStations.length) {
      layers.push(
        ...seismographStationLayers(
          seismoStations,
          seismoActive ? `${seismoActive.net}.${seismoActive.sta}.${seismoActive.loc}.${seismoActive.cha}` : null,
        ),
      );
    }

    // Live tide gauges — the real instruments behind the TSUNAMI GAUGE trace,
    // same pattern as the seismograph stations above.
    if (tideStations.length) {
      layers.push(...tideStationLayers(tideStations, tideActive ? tideKeyOf(tideActive) : null));
    }

    // The on-air point the WIND/PRESSURE/WAVE "LOCAL MONITOR" cards are
    // reading — always drawn "active" since it's the single on-air point, not
    // one of several candidates.
    if (weatherPointCenter) {
      layers.push(
        ...stationMarkerLayers(
          "weather-point",
          [weatherPointCenter],
          (d) => [d[0], d[1], 0],
          () => true,
          mapHighlightRgb,
        ),
      );
    }

    // Active fires (FIRMS) — glowing hot-spots, above alerts, below cities/tracks.
    if (state.showFires && fires.length) layers.push(...fireLayers(fires));

    // Active volcanoes (Smithsonian/USGS weekly bulletin) — glow + click target,
    // same layer band as fires; the cone glyph itself is the DOM overlay below.
    if (state.showVolcanoes && volcanoes.length) layers.push(...volcanoLayers(volcanoes));

    layerGroupsRef.current.events = layers;
    commitLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    alerts,
    state.showAlerts,
    // Key on the focus VALUE, not the object identity: the cycle hands us a
    // fresh object every tick, and only the ~6 fade increments per step should
    // rebuild the layers (a colour re-upload each — never a re-tessellation).
    alertFocusKey(alertFocus),
    state.showSeismic,
    quakes,
    seismoStations,
    seismoActive,
    tideStations,
    tideActive,
    weatherPointCenter?.[0],
    weatherPointCenter?.[1],
    state.showFires,
    fires,
    state.showVolcanoes,
    volcanoes,
    mapHighlightColor,
  ]);

  // Group 3 — city dots (names are the GlobeLabels canvas overlay).
  useEffect(() => {
    if (!deckRef.current) return;
    const subsolar = state.showDayNight ? subsolarPoint(new Date()) : null;
    const zoom = viewStateRef.current.zoom;
    layerGroupsRef.current.cities =
      state.showCities && cities.length ? cityLayer(cities, subsolar ?? undefined, zoom) : [];
    // The fresh layer is filtered at the live zoom; re-arm the zoom follow.
    lastCityZoomRef.current = zoom;
    commitLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities, state.showCities, state.showDayNight, sunTick]);

  // Group 4 — live tracks on top of everything (trails + orbit rings under the
  // point markers). Rebuilds on every dead-reckon tick — cheaply, now that it's
  // only these layers.
  useEffect(() => {
    if (!deckRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [];
    if (state.showTrails && trails.length) {
      // Trails follow the same per-type filters as the markers, so filtered-out
      // planes/ships don't keep a dangling trail.
      const shown = filterTrails(trails, tracks, state.aircraftStyle, state.shipStyle);
      if (shown.length) layers.push(trailsLayer(shown, state.trailOpacity));
    }
    if (state.showOrbits && orbits.length) layers.push(orbitLayer(orbits));
    if (tracks.length)
      layers.push(
        ...tracksLayer(tracks, {
          satelliteStyle: state.satelliteStyle,
          aircraftStyle: state.aircraftStyle,
          shipStyle: state.shipStyle,
          zoom: state.camera.zoom,
          highlight: highlightTrack ?? null,
        }),
      );
    layerGroupsRef.current.tracks = layers;
    commitLayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tracks,
    orbits,
    trails,
    state.showTrails,
    state.trailOpacity,
    state.showOrbits,
    state.showTrackLabels,
    state.satelliteStyle,
    state.aircraftStyle,
    state.shipStyle,
    state.camera.zoom,
    highlightTrack?.kind,
    highlightTrack?.code,
  ]);

  // Animate the event pulse: while an event is on air, re-commit the layers each
  // frame so the rings expand/fade. When it clears, commit once without them.
  useEffect(() => {
    if (!pulseAt && !hoverPulse && !glowCountryIso && !glowRegionBbox) {
      commitLayers();
      return;
    }
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      // Every commit makes deck walk every layer + sublayer in the stack; the
      // pulse/glow layers themselves are uniform-only now, so the walk IS the
      // cost. 30 Hz is indistinguishable on a 1.5–2.6 s breathe and halves it.
      if (t - last < PULSE_FRAME_MS) return;
      last = t;
      commitLayers();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseAt?.[0], pulseAt?.[1], hoverPulse?.[0], hoverPulse?.[1], glowCountryIso, glowRegionBbox?.[0], glowRegionBbox?.[1], glowRegionBbox?.[2], glowRegionBbox?.[3], mapHighlightColor]);

  // Name labels for the HTML overlay (deck's TextLayer draws blank under the
  // globe). Track names honour the "Names" toggle and always show (minZoom 0);
  // city names follow the Cities layer and reveal progressively by population as
  // you zoom in, with a dim country·population detail line once zoomed close.
  // Capital and city label colours follow the scene's map palette.
  const overlayLabels = useMemo<OverlayLabel[]>(() => {
    const out: OverlayLabel[] = [];
    if (state.showTrackLabels) {
      for (const l of trackLabelData(tracks, {
        satelliteStyle: state.satelliteStyle,
        aircraftStyle: state.aircraftStyle,
        shipStyle: state.shipStyle,
      })) {
        out.push({ ...l, minZoom: 0 });
      }
    }
    if (state.showCables && state.showCableLabels && cables) {
      for (const l of cableNameLabels(cables.cables)) {
        // Reveal cable names once zoomed a little past the whole-globe view so
        // the ocean isn't a wall of text at minimum zoom.
        out.push({ ...l, minZoom: 3 });
      }
    }
    if (state.showCities) {
      for (const c of cities) {
        const minZoom = cityLabelMinZoom(c);
        out.push({
          id: `city:${c.id}`,
          text: c.name,
          detail: cityDetail(c),
          position: [c.lng, c.lat, 0],
          color: c.isCapital ? mapCapitalRgb : mapLabelRgb,
          minZoom,
          // Detail only once zoomed a step past the name's reveal (and never on
          // the whole-globe view), so low zooms stay clean.
          detailMinZoom: Math.max(minZoom + 1, 4.5),
        });
      }
    }
    if (state.showSeismic && seismoStations.length) {
      const activeKey = seismoActive
        ? `${seismoActive.net}.${seismoActive.sta}.${seismoActive.loc}.${seismoActive.cha}`
        : null;
      for (const s of seismoStations) {
        const isActive = seismoKeyOf(s) === activeKey;
        out.push({
          id: `seismo:${seismoKeyOf(s)}`,
          icon: <HeartbeatIcon active={isActive} />,
          text: seismoShortName(s),
          position: [s.lng, s.lat, 0],
          color: isActive ? [67, 217, 255] : [200, 215, 230],
          minZoom: 0,
        });
      }
    }
    if (state.showVolcanoes && volcanoes.length) {
      for (const v of volcanoes) {
        const [r, g, b] = volcanoColor(v);
        out.push({
          id: `volcano:${v.id}`,
          icon: <VolcanoIcon color={`rgb(${r}, ${g}, ${b})`} size={v.status === "erupting" ? 34 : v.status === "unrest" ? 27 : 20} />,
          text: v.status === "erupting" ? v.name : "",
          position: volcanoPosition(v),
          color: [r, g, b],
          minZoom: 0,
        });
      }
    }
    if (tideStations.length) {
      const activeKey = tideActive ? tideKeyOf(tideActive) : null;
      for (const s of tideStations) {
        const isActive = tideKeyOf(s) === activeKey;
        out.push({
          id: `tide:${tideKeyOf(s)}`,
          icon: <WaveIcon active={isActive} />,
          text: tideShortName(s),
          position: [s.lng, s.lat, 0],
          color: isActive ? [60, 150, 230] : [200, 215, 230],
          minZoom: 0,
        });
      }
    }
    if (weatherPointCenter && weatherPointLabel) {
      out.push({
        id: "weather-point",
        icon: <MonitorPinIcon active color={mapHighlightColor} />,
        text: weatherPointLabel,
        position: [weatherPointCenter[0], weatherPointCenter[1], 0],
        color: mapHighlightRgb,
        minZoom: 0,
      });
    }
    return out;
  }, [
    state.showTrackLabels,
    state.showCities,
    state.showSeismic,
    state.showCables,
    state.showCableLabels,
    state.showVolcanoes,
    cables,
    tracks,
    cities,
    seismoStations,
    seismoActive,
    tideStations,
    tideActive,
    weatherPointCenter?.[0],
    weatherPointCenter?.[1],
    weatherPointLabel,
    volcanoes,
    state.satelliteStyle,
    state.aircraftStyle,
    state.shipStyle,
    mapHighlightColor,
    mapLabelColor,
    mapCapitalColor,
  ]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <GlobeAtmosphere getDisc={getDisc} enabled={state.showAtmosphere !== false} />
      <GlobeLabels getViewport={getViewport} getCamera={getCamera} labels={overlayLabels} />
    </div>
  );
});

export default Globe;

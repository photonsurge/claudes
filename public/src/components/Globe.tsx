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
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Deck, _GlobeView as GlobeView, LinearInterpolator } from "@deck.gl/core";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import { loadTexture, type LoadedTexture } from "../lib/textures";
import { textureUrlFor } from "./layers/props";
import { basemapLayers, countriesLayer, TILE_MIN_ZOOM } from "./layers/basemap";
import {
  windParticleLayer,
  scalarRasterLayer,
  pressureLayers,
  cityLayer,
  type TextureResolver,
} from "./layers";
import type { City } from "../lib/cities";
import { tracksLayer, orbitLayer, trailsLayer } from "./layers/tracks";
import { alertsLayer } from "./layers/alerts";
import { seismicLayer } from "./layers/seismic";
import type { Track, Quake } from "../lib/tracks/types";
import type { TrackPath } from "../lib/tracks/client";
import type { OrbitSegment } from "../lib/tracks/orbit";
import type { AlertFeature } from "../lib/alerts";

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
  /** Recent earthquakes (USGS). */
  quakes?: Quake[];
  interactive?: boolean;
  onCameraChange?: (center: [number, number], zoom: number) => void;
}

const interpolator = new LinearInterpolator(["longitude", "latitude", "zoom"]);

type ViewState = { longitude: number; latitude: number; zoom: number } & Record<string, unknown>;

/** Flight duration bounds (ms). Actual duration scales with travel distance. */
const FLY_MIN = 1200;
const FLY_MAX = 3500;

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

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { state, manifest, cities, tracks = [], orbits = [], trails = [], alerts = [], quakes = [], interactive = true, onCameraChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const deckRef = useRef<Deck<GlobeView[]> | null>(null);
  const viewStateRef = useRef<ViewState>({
    longitude: state.camera.center[0],
    latitude: state.camera.center[1],
    zoom: state.camera.zoom,
  });
  const [loadedTextures, setLoadedTextures] = useState<Map<string, LoadedTexture>>(new Map());
  // Whether sharp XYZ tiles overlay the raster base (true once zoomed in).
  const [tilesActive, setTilesActive] = useState(state.camera.zoom >= TILE_MIN_ZOOM);

  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  });

  // Live flag read inside the once-created deck callback below.
  const autoSpinRef = useRef(state.autoSpin);
  useEffect(() => {
    autoSpinRef.current = state.autoSpin;
  });

  const applyViewState = (vs: ViewState) => {
    viewStateRef.current = vs;
    if (typeof vs.zoom === "number") {
      const want = vs.zoom >= TILE_MIN_ZOOM;
      setTilesActive((prev) => (prev === want ? prev : want));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deckRef.current?.setProps({ viewState: vs } as any);
  };

  // True while a programmatic flight is animating. The auto-spin rAF loop yields
  // to it (otherwise the per-frame longitude write would fight the transition
  // and the camera would never reach the target).
  const flyingRef = useRef(false);
  const flyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Raise the flying flag and arm a self-clearing safety net: a superseding
  // flyTo cancels the prior transition WITHOUT firing its onTransitionEnd, so we
  // must never rely on that alone to lower the flag (or the spin loop would
  // yield forever).
  const beginFlight = () => {
    flyingRef.current = true;
    if (flyTimerRef.current) clearTimeout(flyTimerRef.current);
    flyTimerRef.current = setTimeout(() => {
      flyingRef.current = false;
    }, FLY_MAX + 300);
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

  // Unwrap a target longitude to the nearest turn of the current one so a flyTo
  // across the ±180° seam takes the short way instead of spinning all the way
  // round.
  const shortestLng = (target: number) => {
    let lng = target;
    while (lng - viewStateRef.current.longitude > 180) lng -= 360;
    while (lng - viewStateRef.current.longitude < -180) lng += 360;
    return lng;
  };

  // Longer trips take (proportionally) longer so the globe glides rather than
  // snapping. `targetLng` must already be seam-unwrapped (shortestLng).
  const flyDurationFor = (targetLng: number, targetLat: number, targetZoom: number) => {
    const vs = viewStateRef.current;
    const dist = Math.hypot(targetLng - vs.longitude, targetLat - vs.latitude);
    const dZoom = Math.abs(targetZoom - vs.zoom);
    return Math.min(FLY_MAX, Math.max(FLY_MIN, 900 + dist * 12 + dZoom * 240));
  };

  const flyToInternal = (lng: number, lat: number, zoom: number) => {
    const target = shortestLng(lng);
    beginFlight();
    // Broadcast the destination ONCE up front so /watch runs the same eased
    // flight in parallel (no per-frame socket traffic); commitCamera re-emits on
    // landing to correct any drift.
    onCameraChangeRef.current?.([lng, lat], zoom);
    applyViewState({
      longitude: target,
      latitude: lat,
      zoom,
      transitionDuration: flyDurationFor(target, lat, zoom),
      transitionInterpolator: interpolator,
      transitionEasing: easeInOutCubic,
      onTransitionEnd: commitCamera,
    } as ViewState);
  };

  useImperativeHandle(ref, () => ({
    flyTo: (center, zoom) =>
      flyToInternal(center[0], center[1], zoom ?? viewStateRef.current.zoom),
    fitBounds: (bbox) =>
      flyToInternal((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2, zoomForBbox(bbox)),
  }));

  // ── Deck init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current || deckRef.current) return;
    const deck = new Deck<GlobeView[]>({
      canvas: canvasRef.current,
      views: [new GlobeView({ id: "globe" })],
      controller: interactive,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      viewState: viewStateRef.current as any,
      layers: [],
      // Hover a plane/ship/satellite → metadata card (flag, code, alt, speed…).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getTooltip: ({ object }: any) => trackTooltip(object),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onViewStateChange: ({ viewState, interactionState }: any) => {
        viewStateRef.current = viewState;
        // While auto-spinning, the rAF loop owns the camera. deck re-emits this
        // callback for the loop's setProps; feeding that back into React state
        // would re-render/persist every frame (infinite loop + poll storm), so
        // bail out — only react to real user interaction.
        if (autoSpinRef.current) return;
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
        onCameraChangeRef.current?.([viewState.longitude, viewState.latitude], viewState.zoom);
      },
    });
    deckRef.current = deck;
    return () => {
      deck.finalize();
      deckRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Follow external camera (e.g. /watch mirroring the operator's view) ────
  useEffect(() => {
    // Only /watch follows. The operator (interactive) drives its own camera via
    // the deck controller + imperative flyTo/fitBounds; making it also chase
    // state.camera would start a competing transition that cancels the flight.
    if (interactive) return;
    const vs = viewStateRef.current;
    const c = state.camera;
    // Unwrap target longitude to the nearest representation of the current one
    // so following across the ±180° seam takes the short way (no backspin flash).
    let lng = c.center[0];
    while (lng - vs.longitude > 180) lng -= 360;
    while (lng - vs.longitude < -180) lng += 360;

    const dLng = Math.abs(lng - vs.longitude);
    const dZoom = Math.abs(vs.zoom - c.zoom);
    const changed = dLng > 1e-4 || Math.abs(vs.latitude - c.center[1]) > 1e-4 || dZoom > 1e-4;
    if (changed) {
      // Small steps (a live drag-follow tick) snap quickly so dragging feels
      // live; large jumps (flyTo / region presets) ease over the same
      // distance-scaled duration the operator's globe uses, so the two globes
      // translate together.
      const small = dLng < 5 && dZoom < 0.5;
      applyViewState({
        longitude: lng,
        latitude: c.center[1],
        zoom: c.zoom,
        transitionDuration: small ? 150 : flyDurationFor(lng, c.center[1], c.zoom),
        transitionInterpolator: interpolator,
        transitionEasing: easeInOutCubic,
      } as ViewState);
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
    if (!state.autoSpin) return;
    const anchorLng = state.camera.center[0];
    const epoch = state.spinEpoch || Date.now();
    let raf = 0;
    const loop = () => {
      // A flyTo/fitBounds is animating — let it own the camera this frame.
      if (flyingRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const vs = viewStateRef.current;
      let longitude = anchorLng + state.spinSpeed * ((Date.now() - epoch) / 1000);
      longitude = ((((longitude + 180) % 360) + 360) % 360) - 180; // wrap to −180..180
      applyViewState({ longitude, latitude: vs.latitude, zoom: vs.zoom });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.autoSpin, state.spinSpeed, state.spinEpoch, state.camera]);

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

  // ── Texture loading for the active fhr ────────────────────────────────────
  useEffect(() => {
    if (!manifest) return;
    const urls = new Set<string>();
    const add = (u?: string) => {
      if (u) urls.add(u);
    };
    if (state.showWind) add(textureUrlFor(manifest, "wind", state.fhr));
    if (state.activeVariable) add(textureUrlFor(manifest, state.activeVariable, state.fhr));
    if (state.showPressure) add(textureUrlFor(manifest, "pressure", state.fhr));

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
  }, [manifest, state.fhr, state.activeVariable, state.showWind, state.showPressure]);

  // ── Rebuild all layers (basemap → weather → borders → cities) ─────────────
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const resolve: TextureResolver = (url) => loadedTextures.get(url);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [...basemapLayers(state, tilesActive)];

    if (manifest) {
      if (state.activeVariable) {
        const l = scalarRasterLayer(manifest, state.activeVariable, state.fhr, resolve);
        if (l) layers.push(l);
      }
      if (state.showPressure) layers.push(...pressureLayers(manifest, state.fhr, resolve));
      if (state.showWind) {
        const l = windParticleLayer(manifest, state.fhr, resolve, state.wind);
        if (l) layers.push(l);
      }
    }

    // Country borders sit ABOVE the weather fill.
    layers.push(countriesLayer(state));

    // Weather-alert polygons above borders, below cities/tracks.
    if (state.showAlerts && alerts.length) layers.push(alertsLayer(alerts));

    // Earthquakes above alerts, below cities/tracks.
    if (state.showSeismic && quakes.length) layers.push(...seismicLayer(quakes));

    if (state.showCities && cities.length) layers.push(...cityLayer(cities));

    // Live tracks overlay sits on top of everything (trails + orbit rings under
    // the point markers).
    if (state.showTrails && trails.length) layers.push(trailsLayer(trails, state.trailOpacity));
    if (state.showOrbits && orbits.length) layers.push(orbitLayer(orbits));
    if (tracks.length)
      layers.push(
        ...tracksLayer(tracks, {
          labels: state.showTrackLabels,
          aircraftStyle: state.aircraftStyle,
          shipStyle: state.shipStyle,
          zoom: state.camera.zoom,
        }),
      );

    deck.setProps({ layers });
  }, [
    manifest,
    cities,
    loadedTextures,
    tilesActive,
    state.basemap,
    state.activeVariable,
    state.showPressure,
    state.showWind,
    state.showCities,
    state.fhr,
    state.basemapColors,
    state.wind,
    state.windMode,
    state.showContours,
    state.showRadar,
    state.showTrackLabels,
    state.aircraftStyle,
    state.shipStyle,
    state.showOrbits,
    state.showTrails,
    state.trailOpacity,
    state.showAlerts,
    state.showSeismic,
    tracks,
    orbits,
    trails,
    alerts,
    quakes,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
});

export default Globe;

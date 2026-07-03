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
import { loadTexture, type LoadedTexture } from "../lib/textures";
import { textureUrlFor } from "./layers/props";
import { basemapLayers, countriesLayer, TILE_MIN_ZOOM } from "./layers/basemap";
import {
  scalarRasterLayers,
  vectorParticleLayers,
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
import { seismicLayer } from "./layers/seismic";
import { graticuleLayer } from "./layers/graticule";
import { sourceDebugLayers } from "./layers/sourceDebug";
import { cableLayers, cableNameLabels } from "./layers/cables";
import { faultLayers } from "./layers/faults";
import { auroraLayers } from "./layers/aurora";
import { satimgLayers } from "./layers/satimg";
import { fireLayers } from "./layers/fires";
import { nightLayer } from "./layers/nightside";
import { subsolarPoint } from "../lib/sun";
import { discFromProject, type Disc } from "../lib/globe-geom";
import GlobeAtmosphere from "./GlobeAtmosphere";
import GlobeLabels, { type OverlayLabel } from "./GlobeLabels";
import type { Track, Quake } from "../lib/tracks/types";
import type { TrackPath } from "../lib/tracks/client";
import type { OrbitSegment } from "../lib/tracks/orbit";
import type { AlertFeature } from "../lib/alerts";
import type { Segment } from "@photonsurge/shared/director";
import { quakeToSegment, alertFeatureToSegment } from "../lib/select-segment";
import type { CableOverlay } from "../lib/cables-overlay";
import type { Fault } from "@photonsurge/shared/faults/types";
import type { AuroraOverlay } from "../lib/aurora-overlay";
import type { SatImgOverlay } from "../lib/satimg-overlay";
import type { Fire } from "@photonsurge/shared/fires/types";

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
  /** Submarine cables + landing stations. */
  cables?: CableOverlay;
  faults?: Fault[];
  /** Latest baked aurora frame + decoded texture (NOAA SWPC OVATION), or null. */
  aurora?: AuroraOverlay | null;
  /** Latest baked geostationary satellite-imagery frames (Himawari-9 …), or null. */
  satimg?: SatImgOverlay | null;
  /** Worker-cached active fires (NASA FIRMS). */
  fires?: Fire[];
  interactive?: boolean;
  onCameraChange?: (center: [number, number], zoom: number) => void;
  /** [lng,lat] of the active event to pulse-highlight, or null/undefined for none. */
  pulseAt?: [number, number] | null;
  /** On-air plane/ship to spotlight with a locator ring on the globe, or null. */
  highlightTrack?: TrackHighlight | null;
  /**
   * Click-to-select an event/quake → its info-box segment (null when the click
   * misses every pickable event). Undefined disables selection entirely.
   */
  onSelect?: (segment: Segment | null) => void;
}


type ViewState = { longitude: number; latitude: number; zoom: number } & Record<string, unknown>;

/** Flight duration bounds (ms). Actual duration scales with travel distance. */
const FLY_MIN = 2600;
const FLY_MAX = 7000;

/** Max extra zoom a detail-shot push-in may add over its hold (zoom levels). */
const MAX_PUSH_IN = 1.2;

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
  { state, manifest, cities, tracks = [], orbits = [], trails = [], alerts = [], quakes = [], cables, faults, aurora, satimg, fires = [], interactive = true, onCameraChange, pulseAt, highlightTrack, onSelect },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const deckRef = useRef<Deck<GlobeView[]> | null>(null);
  // The non-pulse layers, kept so the pulse rAF can re-commit them each frame.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseLayersRef = useRef<any[]>([]);
  const pulseAtRef = useRef<[number, number] | null>(pulseAt ?? null);
  useEffect(() => {
    pulseAtRef.current = pulseAt ?? null;
  });
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

  // Live flag read inside the once-created deck callback below: true whenever a
  // deterministic camera motion (orbit spin or push-in zoom drift) owns the
  // camera, so onViewStateChange doesn't feed those frames back into React.
  const motionRef = useRef(state.autoSpin || !!state.zoomDrift);
  useEffect(() => {
    motionRef.current = state.autoSpin || !!state.zoomDrift;
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
    if (cut) pulse = onAirPulseLayers(alertsRef.current, cut, Date.now());
    else if (hover) pulse = onAirPulseLayers(hover.features, hover.at, Date.now());
    const layers = pulse.length ? [...baseLayersRef.current, ...pulse] : baseLayersRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deckRef.current?.setProps({ layers } as any);
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

  // Animate a camera flight ourselves with an rAF loop instead of deck's
  // viewState transitions — those only run when a controller is enabled, so on
  // the /watch globe (controller off) they were silently dropped and the camera
  // jumped. This drives both globes the same way: it rotates the world toward the
  // target (longitude/latitude move, which on a GlobeView turns the sphere) and
  // dips the zoom OUT mid-flight and back IN, so a far cut sweeps up over the
  // planet and settles. Endpoints are exact (sin(πt) = 0 at t=0 and t=1).
  const flightRafRef = useRef<number | null>(null);
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
    const duration = Math.min(FLY_MAX, Math.max(FLY_MIN, 1300 + dist * 28 + dZoom * 320));
    // Keep the mid-flight pull-back shallow so cuts stay near the surface and the
    // weather/eye-candy never shrinks to a distant dot before settling.
    const dip = Math.min(1.0, dist * 0.014); // zoom levels to pull back mid-flight
    beginFlight();
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
      views: [new GlobeView({ id: "globe" })],
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
      // Click an earthquake / alert polygon → its info-box segment (same card the
      // director shows on air). Clicking empty globe clears the selection.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onClick: (info: any) => {
        const cb = onSelectRef.current;
        if (!cb) return;
        const layerId: string = info?.layer?.id ?? "";
        if (info?.object && layerId.startsWith("seismic")) cb(quakeToSegment(info.object));
        else if (info?.object && layerId.startsWith("alerts")) cb(alertFeatureToSegment(info.object));
        else cb(null);
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
    if (spinSpeed === 0 && zoomDrift === 0) return;
    // Anchor to the cut so motion is deterministic (same on /control and /watch).
    // WIDE shots orbit (spinSpeed>0) around the anchor longitude; DETAIL shots
    // push in (zoomDrift>0) while staying dead-centred on anchorLng/anchorLat.
    const anchorLng = state.camera.center[0];
    const anchorLat = state.camera.center[1];
    const anchorZoom = state.camera.zoom;
    const epoch = state.spinEpoch || Date.now();
    let raf = 0;
    const loop = () => {
      // A flyTo/fitBounds is animating — let it own the camera this frame.
      if (flyingRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const dt = (Date.now() - epoch) / 1000;
      let longitude = anchorLng + spinSpeed * dt;
      longitude = ((((longitude + 180) % 360) + 360) % 360) - 180; // wrap to −180..180
      // Creep closer, capped so a long hold doesn't bore through the surface.
      const zoom = anchorZoom + Math.min(zoomDrift * dt, MAX_PUSH_IN);
      applyViewState({ longitude, latitude: anchorLat, zoom });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.autoSpin, state.spinSpeed, state.zoomDrift, state.spinEpoch, state.camera]);

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

  // ── Rebuild all layers (basemap → weather → borders → cities) ─────────────
  useEffect(() => {
    const deck = deckRef.current;
    if (!deck) return;
    const resolve: TextureResolver = (url) => loadedTextures.get(url);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const hasGlobalRaster = weatherRaster || reliefBasemap || contourOn;
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
        layers.push(...scalarRasterLayers(manifest, state.activeVariable, state.fhr, resolve, camera));
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
        layers.push(...vectorParticleLayers(manifest, "wind", state.fhr, resolve, camera, state.wind));
      }
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
      layers.push(...satimgLayers(satimg.frames));
    }

    // Aurora oval — a translucent glow above the weather/wind/borders but below
    // the vector reference overlays (cables/faults/alerts/cities/tracks) so those
    // stay crisp on top. Pre-baked PNG; the far-side oval is depth-occluded.
    if (state.showAurora && aurora?.texture) {
      layers.push(...auroraLayers(aurora.meta, aurora.texture));
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

    // Weather-alert polygons above borders, below cities/tracks. Kept mounted
    // (visibility toggled, not added/removed) so a director cut flipping
    // showAlerts doesn't force a cold re-tessellation of every polygon.
    if (alerts.length) layers.push(...alertsLayer(alerts, state.showAlerts));

    // Earthquakes above alerts, below cities/tracks.
    if (state.showSeismic && quakes.length) layers.push(...seismicLayer(quakes));

    // Active fires (FIRMS) — glowing hot-spots, above alerts, below cities/tracks.
    if (state.showFires && fires.length) layers.push(...fireLayers(fires));

    if (state.showCities && cities.length)
      layers.push(...cityLayer(cities, subsolar ?? undefined));

    // Live tracks overlay sits on top of everything (trails + orbit rings under
    // the point markers).
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

    baseLayersRef.current = layers;
    commitLayers();
  }, [
    manifest,
    cities,
    loadedTextures,
    tilesActive,
    state.basemap,
    state.activeVariable,
    state.showPressure,
    state.showElevation,
    state.elevation,
    state.showWind,
    state.showCities,
    state.fhr,
    state.basemapColors,
    state.wind,
    state.windMode,
    state.showContours,
    state.showRadar,
    state.showTrackLabels,
    state.satelliteStyle,
    state.aircraftStyle,
    state.shipStyle,
    state.showOrbits,
    state.showTrails,
    state.trailOpacity,
    state.showAlerts,
    state.showSeismic,
    state.showCables,
    state.showCableLabels,
    state.showFaults,
    state.showAurora,
    state.showSatImg,
    state.showFires,
    state.showMapSource,
    state.showGraticule,
    state.graticuleColor,
    state.graticuleLabels,
    state.showDayNight,
    sunTick,
    tracks,
    orbits,
    trails,
    alerts,
    quakes,
    cables,
    faults,
    aurora,
    satimg,
    fires,
    nestKey,
    highlightTrack?.kind,
    highlightTrack?.code,
  ]);

  // Animate the event pulse: while an event is on air, re-commit the layers each
  // frame so the rings expand/fade. When it clears, commit once without them.
  useEffect(() => {
    if (!pulseAt && !hoverPulse) {
      commitLayers();
      return;
    }
    let raf = 0;
    const loop = () => {
      commitLayers();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseAt?.[0], pulseAt?.[1], hoverPulse?.[0], hoverPulse?.[1]]);

  // Name labels for the HTML overlay (deck's TextLayer draws blank under the
  // globe). Track names honour the "Names" toggle and always show (minZoom 0);
  // city names follow the Cities layer and reveal progressively by population as
  // you zoom in, with a dim country·population detail line once zoomed close.
  // Capitals gold, other cities white — matching the city dots.
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
          id: `city:${c.lng.toFixed(3)},${c.lat.toFixed(3)}`,
          text: c.name,
          detail: cityDetail(c),
          position: [c.lng, c.lat, 0],
          color: c.isCapital ? [255, 215, 0] : [255, 255, 255],
          minZoom,
          // Detail only once zoomed a step past the name's reveal (and never on
          // the whole-globe view), so low zooms stay clean.
          detailMinZoom: Math.max(minZoom + 1, 4.5),
        });
      }
    }
    return out;
  }, [
    state.showTrackLabels,
    state.showCities,
    state.showCables,
    state.showCableLabels,
    cables,
    tracks,
    cities,
    state.satelliteStyle,
    state.aircraftStyle,
    state.shipStyle,
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

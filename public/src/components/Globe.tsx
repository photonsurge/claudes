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
import { tracksLayer } from "./layers/tracks";
import type { Track } from "../lib/tracks/types";

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
  interactive?: boolean;
  onCameraChange?: (center: [number, number], zoom: number) => void;
}

const interpolator = new LinearInterpolator(["longitude", "latitude", "zoom"]);

type ViewState = { longitude: number; latitude: number; zoom: number } & Record<string, unknown>;

/** Rough GlobeView zoom that frames a bbox. */
function zoomForBbox(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const span = Math.max(Math.abs(e - w), Math.abs(n - s)) || 1;
  return Math.max(2.5, Math.min(6, Math.log2(360 / span) + 1.9));
}

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { state, manifest, cities, tracks = [], interactive = true, onCameraChange },
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

  const applyViewState = (vs: ViewState) => {
    viewStateRef.current = vs;
    if (typeof vs.zoom === "number") {
      const want = vs.zoom >= TILE_MIN_ZOOM;
      setTilesActive((prev) => (prev === want ? prev : want));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deckRef.current?.setProps({ viewState: vs } as any);
  };

  useImperativeHandle(ref, () => ({
    flyTo: (center, zoom) => {
      applyViewState({
        longitude: center[0],
        latitude: center[1],
        zoom: zoom ?? viewStateRef.current.zoom,
        transitionDuration: 1200,
        transitionInterpolator: interpolator,
      } as ViewState);
    },
    fitBounds: (bbox) => {
      applyViewState({
        longitude: (bbox[0] + bbox[2]) / 2,
        latitude: (bbox[1] + bbox[3]) / 2,
        zoom: zoomForBbox(bbox),
        transitionDuration: 1200,
        transitionInterpolator: interpolator,
      } as ViewState);
    },
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onViewStateChange: ({ viewState }: any) => {
        viewStateRef.current = viewState;
        deck.setProps({ viewState } as Parameters<typeof deck.setProps>[0]);
        const want = viewState.zoom >= TILE_MIN_ZOOM;
        setTilesActive((prev) => (prev === want ? prev : want));
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

  // ── Follow external camera (e.g. /watch receiving the operator's view) ────
  useEffect(() => {
    const vs = viewStateRef.current;
    const c = state.camera;
    const changed =
      Math.abs(vs.longitude - c.center[0]) > 1e-4 ||
      Math.abs(vs.latitude - c.center[1]) > 1e-4 ||
      Math.abs(vs.zoom - c.zoom) > 1e-4;
    if (changed) {
      applyViewState({
        longitude: c.center[0],
        latitude: c.center[1],
        zoom: c.zoom,
        transitionDuration: 600,
        transitionInterpolator: interpolator,
      } as ViewState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.camera]);

  // ── Auto-spin (broadcast idle rotation) ───────────────────────────────────
  // Rotates the camera longitude at spinSpeed °/s via rAF. Uses setProps
  // directly (no onViewStateChange), so it never spams the operator socket.
  useEffect(() => {
    if (!state.autoSpin) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const vs = viewStateRef.current;
      let longitude = vs.longitude + state.spinSpeed * dt;
      longitude = ((((longitude + 180) % 360) + 360) % 360) - 180; // wrap to −180..180
      applyViewState({ longitude, latitude: vs.latitude, zoom: vs.zoom });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.autoSpin, state.spinSpeed]);

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

    if (state.showCities && cities.length) layers.push(...cityLayer(cities));

    // Live tracks overlay sits on top of everything.
    if (tracks.length) layers.push(tracksLayer(tracks));

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
    tracks,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
});

export default Globe;

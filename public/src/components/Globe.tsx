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
import { BitmapLayer, GeoJsonLayer, SolidPolygonLayer } from "@deck.gl/layers";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import { loadTexture, type LoadedTexture } from "../lib/textures";
import { textureUrlFor } from "./layers/props";
import {
  windParticleLayer,
  scalarRasterLayer,
  pressureLayers,
  cityLayer,
  type TextureResolver,
} from "./layers";
import type { City } from "../lib/cities";

export interface GlobeHandle {
  flyTo: (center: [number, number], zoom?: number) => void;
  fitBounds: (bbox: [number, number, number, number]) => void;
}

export interface GlobeProps {
  state: ControlState;
  manifest: WeatherManifest | null;
  cities: City[];
  interactive?: boolean;
  onCameraChange?: (center: [number, number], zoom: number) => void;
}

// Natural Earth / Blue Marble assets (all CORS-enabled).
const LAND_URL =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_land.geojson";
const COUNTRIES_URL =
  "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_countries.geojson";
const SATELLITE_IMG =
  "https://upload.wikimedia.org/wikipedia/commons/8/83/Equirectangular_projection_SW.jpg";

// Full-globe background ring (extra vertices so it tessellates around the sphere).
const GLOBE_RING = [
  [-180, 90],
  [0, 90],
  [180, 90],
  [180, -90],
  [0, -90],
  [-180, -90],
];

const interpolator = new LinearInterpolator(["longitude", "latitude", "zoom"]);

type ViewState = { longitude: number; latitude: number; zoom: number } & Record<string, unknown>;

/** Bottom basemap layers for the active basemap id. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function basemapLayers(basemapId: string): any[] {
  if (basemapId === "satellite" || basemapId === "terrain") {
    return [
      new BitmapLayer({
        id: "basemap-image",
        image: SATELLITE_IMG,
        bounds: [-180, -90, 180, 90],
      }),
    ];
  }
  // dark: dark ocean sphere + subtle land fill
  return [
    new SolidPolygonLayer({
      id: "basemap-ocean",
      data: [GLOBE_RING],
      getPolygon: (d) => d as number[][],
      stroked: false,
      filled: true,
      getFillColor: [8, 14, 24],
    }),
    new GeoJsonLayer({
      id: "basemap-land",
      data: LAND_URL,
      stroked: false,
      filled: true,
      getFillColor: [28, 34, 46],
    }),
  ];
}

/** Country borders — stroke only, drawn above the weather. */
function countriesLayer() {
  return new GeoJsonLayer({
    id: "country-borders",
    data: COUNTRIES_URL,
    stroked: true,
    filled: false,
    getLineColor: [220, 228, 240, 170],
    lineWidthUnits: "pixels",
    getLineWidth: 1,
    lineWidthMinPixels: 0.6,
    parameters: { depthTest: false },
  });
}

/** Rough GlobeView zoom that frames a bbox. */
function zoomForBbox(bbox: [number, number, number, number]): number {
  const [w, s, e, n] = bbox;
  const span = Math.max(Math.abs(e - w), Math.abs(n - s)) || 1;
  return Math.max(0, Math.min(5, Math.log2(360 / span) - 0.6));
}

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { state, manifest, cities, interactive = true, onCameraChange },
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

  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => {
    onCameraChangeRef.current = onCameraChange;
  });

  const applyViewState = (vs: ViewState) => {
    viewStateRef.current = vs;
    deckRef.current?.setProps({ viewState: vs });
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
      viewState: viewStateRef.current,
      parameters: { clearColor: [0, 0, 0, 1] },
      layers: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onViewStateChange: ({ viewState }: any) => {
        viewStateRef.current = viewState;
        deck.setProps({ viewState });
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
    const layers: any[] = [...basemapLayers(state.basemap)];

    if (manifest) {
      if (state.activeVariable) {
        const l = scalarRasterLayer(manifest, state.activeVariable, state.fhr, resolve);
        if (l) layers.push(l);
      }
      if (state.showPressure) layers.push(...pressureLayers(manifest, state.fhr, resolve));
      if (state.showWind) {
        const l = windParticleLayer(manifest, state.fhr, resolve);
        if (l) layers.push(l);
      }
    }

    // Country borders sit ABOVE the weather fill.
    layers.push(countriesLayer());

    if (state.showCities && cities.length) layers.push(...cityLayer(cities));

    deck.setProps({ layers });
  }, [
    manifest,
    cities,
    loadedTextures,
    state.basemap,
    state.activeVariable,
    state.showPressure,
    state.showWind,
    state.showCities,
    state.fhr,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
});

export default Globe;

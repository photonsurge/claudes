"use client";

/**
 * MapLibre globe with a deck.gl MapboxOverlay (overlaid mode — required for
 * WeatherLayers particles on a globe). Rebuilds weather/city layers whenever the
 * manifest, control state, loaded textures, or cities change. Switching basemaps
 * calls map.setStyle. Exposes imperative flyTo / fitBounds via ref.
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
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { ControlState } from "@photonsurge/shared/control";
import { basemapStyle, resolveBasemapId, bboxToFitBounds } from "../lib/selectors";
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
  /** Called when the user moves the map (control page persists camera). */
  onCameraChange?: (center: [number, number], zoom: number) => void;
}

const Globe = forwardRef<GlobeHandle, GlobeProps>(function Globe(
  { state, manifest, cities, interactive = true, onCameraChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const currentBasemap = useRef<string>(resolveBasemapId(state.basemap));
  const [loadedTextures, setLoadedTextures] = useState<Map<string, LoadedTexture>>(
    new Map(),
  );

  useImperativeHandle(ref, () => ({
    flyTo: (center, zoom) => {
      mapRef.current?.flyTo({ center, zoom: zoom ?? mapRef.current.getZoom() });
    },
    fitBounds: (bbox) => {
      mapRef.current?.fitBounds(bboxToFitBounds(bbox), { padding: 40, duration: 800 });
    },
  }));

  // ── Map init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const basemapId = resolveBasemapId(state.basemap);
    currentBasemap.current = basemapId;

    const map = new maplibregl.Map({
      container: containerRef.current,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: basemapStyle(basemapId) as any,
      center: state.camera.center,
      zoom: state.camera.zoom,
      interactive,
      attributionControl: false,
    });
    map.on("load", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).setProjection?.({ type: "globe" });
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.addControl(overlay as any);

    if (onCameraChange) {
      map.on("moveend", () => {
        const c = map.getCenter();
        onCameraChange([c.lng, c.lat], map.getZoom());
      });
    }

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      overlay.finalize?.();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // Init once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Basemap switching ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = resolveBasemapId(state.basemap);
    if (next === currentBasemap.current) return;
    currentBasemap.current = next;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.setStyle(basemapStyle(next) as any);
    map.once("styledata", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (map as any).setProjection?.({ type: "globe" });
    });
  }, [state.basemap]);

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
    Promise.all(
      [...urls].map(async (url) => [url, await loadTexture(url)] as const),
    ).then((pairs) => {
      if (cancelled) return;
      // Keep old textures (no flash); merge new ones in.
      setLoadedTextures((prev) => {
        const next = new Map(prev);
        for (const [url, tex] of pairs) next.set(url, tex);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [manifest, state.fhr, state.activeVariable, state.showWind, state.showPressure]);

  // ── Rebuild deck layers ──────────────────────────────────────────────────
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const resolve: TextureResolver = (url) => loadedTextures.get(url);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = [];
    if (manifest) {
      if (state.activeVariable) {
        const l = scalarRasterLayer(manifest, state.activeVariable, state.fhr, resolve);
        if (l) layers.push(l);
      }
      if (state.showPressure) {
        layers.push(...pressureLayers(manifest, state.fhr, resolve));
      }
      if (state.showWind) {
        const l = windParticleLayer(manifest, state.fhr, resolve);
        if (l) layers.push(l);
      }
    }
    if (state.showCities && cities.length) {
      layers.push(...cityLayer(cities));
    }
    overlay.setProps({ layers });
  }, [manifest, cities, loadedTextures, state.activeVariable, state.showPressure, state.showWind, state.showCities, state.fhr]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
});

export default Globe;

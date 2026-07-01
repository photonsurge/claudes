/**
 * Layer construction: turn the PURE props (props.ts) into deck.gl /
 * WeatherLayers layer instances. Kept thin so all logic stays testable in
 * props.ts and the GL-bound construction here is mocked in tests.
 */
"use client";

import { ScatterplotLayer } from "@deck.gl/layers";
import {
  RasterLayer,
  ParticleLayer,
  ContourLayer,
  HighLowLayer,
} from "weatherlayers-gl";
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { LoadedTexture } from "../../lib/textures";
import type { City } from "../../lib/cities";
import {
  windParticleProps,
  vectorParticleProps,
  vectorParticlePropsFromEntry,
  scalarRasterProps,
  scalarRasterPropsFromEntry,
  pressureProps,
  cityProps,
  manifestBounds,
  type Bounds,
} from "./props";
import { resolveEntries, type ResolverCamera } from "./resolve";
import { DEPTH_OCCLUDE, DEPTH_TEST, DEPTH_PAINT } from "./depth";

/** A resolver mapping a texture URL to an already-loaded image (or undefined). */
export type TextureResolver = (url: string) => LoadedTexture | undefined;

/**
 * Vector ParticleLayer for any uv field (wind, ocean current). Decodes u/v via
 * the manifest's `vectorUnscale`; `opts.colorByMagnitude` colours by speed
 * (currents) instead of the flat colour (wind).
 */
export function vectorParticleLayer(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  resolve: TextureResolver,
  opts?: Parameters<typeof vectorParticleProps>[3],
): ParticleLayer | null {
  const props = vectorParticleProps(manifest, variableId, fhr, opts);
  if (!props) return null;
  const image = resolve(props.image);
  if (!image) return null;
  // WeatherLayers accepts an ImageBitmap/HTMLImageElement at runtime; its prop
  // type is narrower than that, so cast at the boundary.
  // Depth-tested so the far hemisphere is occluded by the depth sphere; this also
  // overrides WeatherLayers' own `depthCompare: "always"` (which would otherwise
  // bleed back-side particles through AND disable depth for later layers).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new ParticleLayer({ ...props, image: image as any, parameters: DEPTH_TEST });
}

export function windParticleLayer(
  manifest: WeatherManifest,
  fhr: number,
  resolve: TextureResolver,
  opts?: Parameters<typeof windParticleProps>[2],
): ParticleLayer | null {
  return vectorParticleLayer(manifest, "wind", fhr, resolve, opts);
}

export function scalarRasterLayer(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  resolve: TextureResolver,
  opts?: Parameters<typeof scalarRasterProps>[3],
): RasterLayer | null {
  const props = scalarRasterProps(manifest, variableId, fhr, opts);
  if (!props) return null;
  const image = resolve(props.image);
  if (!image) return null;
  // The raster fills the whole globe, so it both tests AND writes depth: its far
  // hemisphere is occluded by the depth sphere, and its near hemisphere seals the
  // surface (overriding WeatherLayers' `depthCompare: "always"`) so nothing on the
  // far side bleeds through the front ("see-through globe").
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new RasterLayer({ ...props, image: image as any, parameters: DEPTH_OCCLUDE });
}

/**
 * Regional-nest aware scalar rasters: the global base plus every ACTIVE nest for
 * this variable at the current camera, finest last (drawn on top). Each nest is
 * the same RasterLayer clipped to its own `bbox`. A nest-only variable (radar,
 * empty base `files`) yields just its nests; a source with no nests yields the
 * single base layer — identical to `scalarRasterLayer`.
 */
export function scalarRasterLayers(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  resolve: TextureResolver,
  camera: ResolverCamera,
  opts?: { opacity?: number },
): RasterLayer[] {
  const entries = resolveEntries(manifest.variables[variableId], camera);
  const out: RasterLayer[] = [];
  entries.forEach((entry, i) => {
    // Base (i === 0) fills the globe; nests clip to their own bbox.
    const bounds: Bounds | undefined = i === 0 ? manifestBounds(manifest) : entry.bbox;
    if (!bounds) return;
    const props = scalarRasterPropsFromEntry(entry, variableId, fhr, bounds, {
      ...opts,
      // A nest REPLACES the base in its footprint rather than stacking on it: at
      // the base's 0.7 the two coincident rasters would compound to ~0.9 and read
      // as a brighter patch. Full opacity makes the nest's own pixels fully cover
      // the base beneath, so the region shows the sharper field at one consistent
      // exposure (its transparent no-data pixels still let the base through).
      opacity: i === 0 ? opts?.opacity : opts?.opacity ?? 1,
      idSuffix: i === 0 ? "" : `-${entry.sourceId ?? `n${i}`}`,
    });
    if (!props) return;
    const image = resolve(props.image);
    if (!image) return;
    // Base SEALS the depth sphere (DEPTH_OCCLUDE). A nest sits coincident with the
    // base raster, so it must NOT compete for depth — DEPTH_PAINT (no test/write,
    // far side culled by GlobeView's back-face cull) paints it uniformly on top
    // instead of z-fighting into the "spiky fill" artifact. Drawn after the base
    // (finest last), so the nest wins in its bbox.
    const parameters = i === 0 ? DEPTH_OCCLUDE : DEPTH_PAINT;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out.push(new RasterLayer({ ...props, image: image as any, parameters }));
  });
  return out;
}

/**
 * Regional-nest aware vector particles (wind, ocean current): the global base
 * plus every ACTIVE nest at the current camera, finest last. Each nest is the
 * same ParticleLayer clipped to its `bbox`.
 */
export function vectorParticleLayers(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  resolve: TextureResolver,
  camera: ResolverCamera,
  opts?: Parameters<typeof vectorParticleProps>[3],
): ParticleLayer[] {
  const entries = resolveEntries(manifest.variables[variableId], camera);
  const out: ParticleLayer[] = [];
  entries.forEach((entry, i) => {
    const bounds: Bounds | undefined = i === 0 ? manifestBounds(manifest) : entry.bbox;
    if (!bounds) return;
    const props = vectorParticlePropsFromEntry(entry, variableId, fhr, bounds, {
      ...opts,
      idSuffix: i === 0 ? "" : `-${entry.sourceId ?? `n${i}`}`,
    });
    if (!props) return;
    const image = resolve(props.image);
    if (!image) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out.push(new ParticleLayer({ ...props, image: image as any, parameters: DEPTH_TEST }));
  });
  return out;
}

export function pressureLayers(
  manifest: WeatherManifest,
  fhr: number,
  resolve: TextureResolver,
  opts?: Parameters<typeof pressureProps>[2],
): Array<ContourLayer | HighLowLayer> {
  const props = pressureProps(manifest, fhr, opts);
  if (!props) return [];
  const image = resolve(props.contour.image);
  if (!image) return [];
  // Depth-tested so far-side isobars/H-L markers are occluded by the depth
  // sphere rather than showing through the front of the globe.
  return [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new ContourLayer({ ...props.contour, image: image as any, parameters: DEPTH_TEST }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new HighLowLayer({ ...props.highLow, image: image as any, parameters: DEPTH_TEST }),
  ];
}

export function cityLayer(
  cities: City[],
  subsolar?: [number, number],
): Array<ScatterplotLayer> {
  const props = cityProps(cities, subsolar);
  // When the sun moves, the per-city night factor changes → recompute the dot
  // radius/colour. Keyed to the subsolar point (rounded, so it retriggers as the
  // terminator advances but not on every identical rebuild).
  const nightKey = subsolar ? `${subsolar[0].toFixed(1)},${subsolar[1].toFixed(1)}` : "off";
  // Dots only. City NAME labels are drawn by the HTML overlay (GlobeLabels), not
  // a TextLayer — deck's font atlases come back blank under the _GlobeView build.
  return [
    new ScatterplotLayer({
      ...props.scatter,
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      stroked: true,
      lineWidthMinPixels: 1,
      getLineColor: [0, 0, 0, 180],
      pickable: false,
      parameters: DEPTH_TEST,
      updateTriggers: { getRadius: nightKey, getFillColor: nightKey },
    }),
  ];
}

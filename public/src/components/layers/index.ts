/**
 * Layer construction: turn the PURE props (props.ts) into deck.gl /
 * WeatherLayers layer instances. Kept thin so all logic stays testable in
 * props.ts and the GL-bound construction here is mocked in tests.
 */
"use client";

import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
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
  scalarRasterProps,
  pressureProps,
  cityProps,
} from "./props";
import { DEPTH_OCCLUDE, DEPTH_TEST } from "./depth";

/** A resolver mapping a texture URL to an already-loaded image (or undefined). */
export type TextureResolver = (url: string) => LoadedTexture | undefined;

/**
 * Glyph atlas coverage for city labels: printable ASCII (0x20–0x7E) plus the
 * Latin-1 Supplement (0xA0–0xFF: é, ã, ü, ó …) and Latin Extended-A
 * (0x100–0x17F: Ō, ō, İ, ā …). A fixed superset keeps the SDF atlas stable for
 * broadcast instead of rebuilding/flashing as new accented names appear.
 */
const CITY_CHARACTER_SET: string[] = (() => {
  const chars: string[] = [];
  for (let c = 0x20; c <= 0x7e; c++) chars.push(String.fromCodePoint(c));
  for (let c = 0xa0; c <= 0x17f; c++) chars.push(String.fromCodePoint(c));
  return chars;
})();

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
): Array<ScatterplotLayer | TextLayer> {
  const props = cityProps(cities, subsolar);
  // When the sun moves, the per-city night factor changes → recompute the dot
  // radius/colour. Keyed to the subsolar point (rounded, so it retriggers as the
  // terminator advances but not on every identical rebuild).
  const nightKey = subsolar ? `${subsolar[0].toFixed(1)},${subsolar[1].toFixed(1)}` : "off";
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
    new TextLayer({
      ...props.text,
      getColor: [255, 255, 255, 230],
      getTextAnchor: "start",
      getAlignmentBaseline: "center",
      getPixelOffset: [8, 0],
      // SDF font rendering is required for outlines; without it deck warns
      // "fontSettings.sdf is required to render outline".
      fontSettings: { sdf: true, buffer: 8, radius: 12 },
      outlineWidth: 2,
      outlineColor: [0, 0, 0, 255],
      fontFamily: "system-ui, sans-serif",
      // City names include accented/non-ASCII glyphs (é, ã, Ō, İ …). Build the
      // glyph atlas from the actual labels so nothing renders blank.
      characterSet: CITY_CHARACTER_SET,
      pickable: false,
      parameters: DEPTH_TEST,
    }),
  ];
}

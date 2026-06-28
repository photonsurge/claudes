/**
 * PURE layer-prop builders. These compute the exact prop objects deck.gl /
 * WeatherLayers layers need from a manifest + active state, with NO layer
 * construction and no GL — so they are fully unit-testable.
 *
 * Texture format (from the worker): all textures are PNG.
 *  - Wind: RGBA PNG, R=u G=v, decoded with `imageUnscale`. → ParticleLayer.
 *  - Scalar: RGBA grayscale PNG, value in R, decoded with `imageUnscale`,
 *    coloured with `palette` + `domain`. → RasterLayer.
 */
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import { getPalette, type Palette } from "@photonsurge/shared/palettes";
import { getVariable } from "@photonsurge/shared/variables";
import type { City } from "../../lib/cities";

/** WeatherLayers `bounds` is [west, south, east, north]. */
export type Bounds = [number, number, number, number];

export function manifestBounds(manifest: WeatherManifest): Bounds {
  const [w, s, e, n] = manifest.bounds;
  return [w, s, e, n];
}

/** The texture URL for a variable at a forecast hour, or undefined. */
export function textureUrlFor(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
): string | undefined {
  const v = manifest.variables[variableId];
  if (!v) return undefined;
  return v.files[String(fhr)];
}

export interface WindParticleProps {
  id: string;
  image: string;
  imageUnscale: [number, number];
  bounds: Bounds;
  numParticles: number;
  speedFactor: number;
  width: number;
  opacity: number;
  visible: boolean;
}

/** PURE props for the wind ParticleLayer. Returns null if no wind texture. */
export function windParticleProps(
  manifest: WeatherManifest,
  fhr: number,
  opts: { numParticles?: number; speedFactor?: number; width?: number; opacity?: number } = {},
): WindParticleProps | null {
  const image = textureUrlFor(manifest, "wind", fhr);
  const entry = manifest.variables.wind;
  if (!image || !entry?.imageUnscale) return null;
  return {
    id: `wind-${fhr}`,
    image,
    imageUnscale: entry.imageUnscale,
    bounds: manifestBounds(manifest),
    numParticles: opts.numParticles ?? 5000,
    speedFactor: opts.speedFactor ?? 2,
    width: opts.width ?? 2,
    opacity: opts.opacity ?? 0.6,
    visible: true,
  };
}

export interface ScalarRasterProps {
  id: string;
  image: string;
  imageUnscale: [number, number] | undefined;
  bounds: Bounds;
  palette: Palette;
  domain: [number, number] | undefined;
  opacity: number;
  visible: boolean;
}

/** PURE props for a scalar RasterLayer (temp/humidity/rain/storm/gust). */
export function scalarRasterProps(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  opts: { opacity?: number } = {},
): ScalarRasterProps | null {
  const image = textureUrlFor(manifest, variableId, fhr);
  const entry = manifest.variables[variableId];
  if (!image || !entry) return null;
  const meta = getVariable(variableId);
  const paletteId = entry.palette ?? meta?.palette ?? variableId;
  const domain = entry.domain ?? meta?.domain;
  return {
    id: `scalar-${variableId}-${fhr}`,
    image,
    imageUnscale: entry.imageUnscale,
    bounds: manifestBounds(manifest),
    palette: getPalette(paletteId),
    domain,
    opacity: opts.opacity ?? 0.7,
    visible: true,
  };
}

export interface PressureProps {
  contour: {
    id: string;
    image: string;
    imageUnscale: [number, number] | undefined;
    bounds: Bounds;
    interval: number;
  };
  highLow: {
    id: string;
    image: string;
    imageUnscale: [number, number] | undefined;
    bounds: Bounds;
    radius: number;
  };
}

/** PURE props for the pressure contour + high/low layers. */
export function pressureProps(
  manifest: WeatherManifest,
  fhr: number,
  opts: { interval?: number; radius?: number } = {},
): PressureProps | null {
  const image = textureUrlFor(manifest, "pressure", fhr);
  const entry = manifest.variables.pressure;
  if (!image || !entry) return null;
  const bounds = manifestBounds(manifest);
  return {
    contour: {
      id: `pressure-contour-${fhr}`,
      image,
      imageUnscale: entry.imageUnscale,
      bounds,
      interval: opts.interval ?? 4,
    },
    highLow: {
      id: `pressure-highlow-${fhr}`,
      image,
      imageUnscale: entry.imageUnscale,
      bounds,
      radius: opts.radius ?? 2_000_000,
    },
  };
}

export interface CityScatterProps {
  id: string;
  data: City[];
  getPosition: (c: City) => [number, number];
  getRadius: (c: City) => number;
  getFillColor: (c: City) => [number, number, number, number];
}

export interface CityTextProps {
  id: string;
  data: City[];
  getPosition: (c: City) => [number, number];
  getText: (c: City) => string;
  getSize: (c: City) => number;
}

/** PURE props for city markers (scatter) and labels (text). */
export function cityProps(cities: City[]): { scatter: CityScatterProps; text: CityTextProps } {
  const getPosition = (c: City): [number, number] => [c.lng, c.lat];
  return {
    scatter: {
      id: "cities-scatter",
      data: cities,
      getPosition,
      getRadius: (c) => (c.isCapital ? 6 : 4),
      getFillColor: (c) =>
        c.isCapital ? [255, 215, 0, 255] : [255, 255, 255, 220],
    },
    text: {
      id: "cities-text",
      data: cities,
      getPosition,
      getText: (c) => c.name,
      getSize: (c) => (c.isCapital ? 14 : 12),
    },
  };
}

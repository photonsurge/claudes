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
import type { WeatherManifest, WeatherVariableManifest } from "@photonsurge/shared/manifest";
import { getPalette, type Palette } from "@photonsurge/shared/palettes";
import { getVariable } from "@photonsurge/shared/variables";
import type { City } from "../../lib/cities";
import { cosSunZenith, nightAlpha } from "../../lib/sun";

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

export interface VectorParticleProps {
  id: string;
  image: string;
  imageUnscale: [number, number];
  bounds: Bounds;
  numParticles: number;
  /** Trail length in frames — the key to streaks instead of static dots. */
  maxAge: number;
  speedFactor: number;
  width: number;
  /** Particle colour (RGBA); white reads cleanly on dark/satellite globes. */
  color: [number, number, number, number];
  /**
   * Optional magnitude colour ramp (physical units). When set (e.g. ocean
   * currents coloured by |v|), the ParticleLayer colours by speed instead of the
   * flat `color`; wind omits it and keeps the single white colour.
   */
  palette?: Palette;
  /** Must be true to advect the particles along the field. */
  animate: boolean;
  opacity: number;
  visible: boolean;
}

/** Back-compat alias — wind is a vector particle field. */
export type WindParticleProps = VectorParticleProps;

export interface VectorParticleOpts {
  numParticles?: number;
  maxAge?: number;
  speedFactor?: number;
  width?: number;
  opacity?: number;
  /** Particle colour as a hex string (`#rrggbb`); defaults to white. */
  color?: string;
  /** Colour particles by magnitude using the variable's palette. */
  colorByMagnitude?: boolean;
  /** Appended to the layer id so a base + its nests get unique ids (deck.gl). */
  idSuffix?: string;
}

/**
 * PURE props for a vector ParticleLayer (wind, ocean current, …). Reads the
 * variable's `vectorUnscale` (or legacy `imageUnscale`) to decode u/v. Returns
 * null when the variable has no texture/unscale at this step.
 */
export function vectorParticleProps(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  opts: VectorParticleOpts = {},
): VectorParticleProps | null {
  const entry = manifest.variables[variableId];
  if (!entry) return null;
  return vectorParticlePropsFromEntry(entry, variableId, fhr, manifestBounds(manifest), opts);
}

/**
 * PURE props for a vector ParticleLayer from an explicit entry + bounds. This is
 * the resolver seam: the global base passes the full-globe bounds; a regional
 * nest passes its own `bbox` (WeatherLayers clips the field to it). Returns null
 * when the entry has no texture/unscale at this step.
 */
export function vectorParticlePropsFromEntry(
  entry: WeatherVariableManifest,
  variableId: string,
  fhr: number,
  bounds: Bounds,
  opts: VectorParticleOpts = {},
): VectorParticleProps | null {
  const image = entry.files[String(fhr)];
  const unscale = entry.vectorUnscale ?? entry.imageUnscale;
  if (!image || !unscale) return null;
  const meta = getVariable(variableId);
  const domain = entry.domain ?? meta?.domain;
  const props: VectorParticleProps = {
    id: `${variableId}-${fhr}${opts.idSuffix ?? ""}`,
    image,
    imageUnscale: unscale,
    bounds,
    numParticles: opts.numParticles ?? 6000,
    // nullschool/Windy look: enough trail + speed to read as flow, animated.
    maxAge: opts.maxAge ?? 30,
    speedFactor: opts.speedFactor ?? 8,
    width: opts.width ?? 2,
    color: hexToRgba(opts.color),
    animate: true,
    opacity: opts.opacity ?? 0.9,
    visible: true,
  };
  if (opts.colorByMagnitude) {
    const paletteId = entry.palette ?? meta?.palette ?? variableId;
    // WeatherLayers maps the ramp against decoded speed, so scale 0..1 stops onto
    // the variable's magnitude domain (e.g. current 0..3 m/s).
    props.palette = scalePaletteToDomain(getPalette(paletteId), domain);
  }
  return props;
}

/** PURE props for the wind ParticleLayer. Returns null if no wind texture. */
export function windParticleProps(
  manifest: WeatherManifest,
  fhr: number,
  opts: Omit<VectorParticleOpts, "colorByMagnitude"> = {},
): WindParticleProps | null {
  return vectorParticleProps(manifest, "wind", fhr, opts);
}

/**
 * Parse a `#rrggbb` (or `#rgb`) hex string into an opaque RGBA tuple. Falls back
 * to white on anything unparseable so the particle layer always renders. Pure.
 */
export function hexToRgba(hex?: string): [number, number, number, number] {
  const white: [number, number, number, number] = [255, 255, 255, 255];
  if (!hex) return white;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return white;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
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

export interface ScalarRasterOpts {
  opacity?: number;
  /** Appended to the layer id so a base + its nests get unique ids (deck.gl). */
  idSuffix?: string;
}

/** PURE props for a scalar RasterLayer (temp/humidity/rain/storm/gust). */
export function scalarRasterProps(
  manifest: WeatherManifest,
  variableId: string,
  fhr: number,
  opts: ScalarRasterOpts = {},
): ScalarRasterProps | null {
  const entry = manifest.variables[variableId];
  if (!entry) return null;
  return scalarRasterPropsFromEntry(entry, variableId, fhr, manifestBounds(manifest), opts);
}

/**
 * PURE props for a scalar RasterLayer from an explicit entry + bounds. Resolver
 * seam: base passes the full-globe bounds; a nest passes its own `bbox` so
 * WeatherLayers clips the raster to the region. Returns null when the entry has
 * no texture at this step (e.g. a nest-only base with empty `files`).
 */
export function scalarRasterPropsFromEntry(
  entry: WeatherVariableManifest,
  variableId: string,
  fhr: number,
  bounds: Bounds,
  opts: ScalarRasterOpts = {},
): ScalarRasterProps | null {
  const image = entry.files[String(fhr)];
  if (!image) return null;
  const meta = getVariable(variableId);
  const paletteId = entry.palette ?? meta?.palette ?? variableId;
  const domain = entry.domain ?? meta?.domain;
  return {
    id: `scalar-${variableId}-${fhr}${opts.idSuffix ?? ""}`,
    image,
    imageUnscale: entry.imageUnscale,
    bounds,
    // WeatherLayers maps the palette against the DECODED physical value, so the
    // palette stops must be in physical units, not normalised 0..1. Scale the
    // 0..1 ramp onto the variable's domain (e.g. temp -40..50 °C).
    palette: scalePaletteToDomain(getPalette(paletteId), domain),
    domain,
    opacity: opts.opacity ?? 0.7,
    visible: true,
  };
}

/** Map a normalised 0..1 palette onto a physical [min,max] domain. */
export function scalePaletteToDomain(palette: Palette, domain?: [number, number]): Palette {
  if (!domain) return palette;
  const [min, max] = domain;
  return palette.map(([stop, hex]) => [min + stop * (max - min), hex] as [number, string]);
}

export interface PressureProps {
  contour: {
    id: string;
    image: string;
    imageUnscale: [number, number] | undefined;
    bounds: Bounds;
    interval: number;
    /** Thicker, emphasised isobars every N hPa. */
    majorInterval: number;
    width: number;
    /** Colour isobars by pressure value (lows cool, highs warm). */
    palette: Palette;
  };
  highLow: {
    id: string;
    image: string;
    imageUnscale: [number, number] | undefined;
    bounds: Bounds;
    radius: number;
    palette: Palette;
    textColor: [number, number, number, number];
    textOutlineColor: [number, number, number, number];
  };
}

/** PURE props for the pressure contour + high/low layers. */
export function pressureProps(
  manifest: WeatherManifest,
  fhr: number,
  opts: { interval?: number; majorInterval?: number; radius?: number } = {},
): PressureProps | null {
  const image = textureUrlFor(manifest, "pressure", fhr);
  const entry = manifest.variables.pressure;
  if (!image || !entry) return null;
  const meta = getVariable("pressure");
  const domain = entry.domain ?? meta?.domain;
  // WeatherLayers maps the palette against the DECODED hPa value, so scale the
  // 0..1 ramp onto the pressure domain (e.g. 950..1050 hPa).
  const palette = scalePaletteToDomain(getPalette("pressure"), domain);
  const bounds = manifestBounds(manifest);
  return {
    contour: {
      id: `pressure-contour-${fhr}`,
      image,
      imageUnscale: entry.imageUnscale,
      bounds,
      interval: opts.interval ?? 4,
      majorInterval: opts.majorInterval ?? 20,
      width: 1,
      palette,
    },
    highLow: {
      id: `pressure-highlow-${fhr}`,
      image,
      imageUnscale: entry.imageUnscale,
      bounds,
      radius: opts.radius ?? 2_000_000,
      palette,
      textColor: [255, 255, 255, 255],
      textOutlineColor: [0, 0, 0, 255],
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

/**
 * PURE props for city markers (scatter) and labels (text). When `subsolar` is
 * given (day/night mode on), cities on the dark side "light up": their dots grow
 * a little and warm to a sodium-glow amber, so the night hemisphere reads as a
 * field of city lights (as on the reference broadcast globe). Day-side cities
 * keep their normal look.
 */
export function cityProps(
  cities: City[],
  subsolar?: [number, number],
): { scatter: CityScatterProps; text: CityTextProps } {
  const getPosition = (c: City): [number, number] => [c.lng, c.lat];
  /** 0 in daylight → 1 in deep night, for this city. */
  const night = (c: City) => (subsolar ? nightAlpha(cosSunZenith(c.lng, c.lat, subsolar)) : 0);
  return {
    scatter: {
      id: "cities-scatter",
      data: cities,
      getPosition,
      getRadius: (c) => (c.isCapital ? 6 : 4) + night(c) * 3,
      getFillColor: (c) => {
        const day: [number, number, number, number] = c.isCapital
          ? [255, 215, 0, 255]
          : [255, 255, 255, 220];
        const t = night(c);
        if (t === 0) return day;
        // Warm the glow toward sodium-amber and lift the alpha on the dark side.
        const glow: [number, number, number, number] = [255, 208, 130, 255];
        return [
          Math.round(day[0] + (glow[0] - day[0]) * t),
          Math.round(day[1] + (glow[1] - day[1]) * t),
          Math.round(day[2] + (glow[2] - day[2]) * t),
          Math.round(day[3] + (255 - day[3]) * t),
        ];
      },
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

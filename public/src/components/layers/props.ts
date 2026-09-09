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
import { cityLabelMinZoom } from "../../lib/cities";
import { cosSunZenith, nightAlpha } from "../../lib/sun";

/** WeatherLayers `bounds` is [west, south, east, north]. */
export type Bounds = [number, number, number, number];

/**
 * Cached per manifest object so the SAME array comes back on every call. deck's
 * BitmapLayer regenerates its (2° globe) mesh whenever `bounds` changes
 * identity — a fresh tuple per layer build meant every rebuild of the layer
 * stack re-meshed every full-globe raster.
 */
const boundsCache = new WeakMap<WeatherManifest, Bounds>();
export function manifestBounds(manifest: WeatherManifest): Bounds {
  let b = boundsCache.get(manifest);
  if (!b) {
    const [w, s, e, n] = manifest.bounds;
    b = [w, s, e, n];
    boundsCache.set(manifest, b);
  }
  return b;
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

/**
 * EVERY texture URL the manifest can serve at `fhr` — each variable's global
 * base map AND each of its regional nests.
 *
 * The preload path warms this whole set at load. Base maps were already kept
 * decoded in RAM (instant director cuts), but the NESTS were not, so flying
 * into a region that has a high-res nest paid a fetch + decode at the cut —
 * exactly the disk and CPU the OBS box is short of, at exactly the moment it
 * can least afford them. RAM is the plentiful resource there (32 GB, and a
 * decoded global frame is ~4 MB), so we trade it.
 *
 * A variable with no file at this hour (elevation and the other statics are
 * baked once, at hour 0) falls back to its hour-0 texture rather than being
 * skipped.
 */
export function allTextureUrlsFor(manifest: WeatherManifest, fhr: number): string[] {
  const urls = new Set<string>();
  const add = (v: { files?: Record<string, string> } | undefined) => {
    const url = v?.files?.[String(fhr)] ?? v?.files?.["0"];
    if (url) urls.add(url);
  };
  for (const v of Object.values(manifest.variables ?? {})) {
    add(v);
    for (const nest of v?.nests ?? []) add(nest);
  }
  return [...urls];
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

export interface WindBarbProps {
  id: string;
  image: string;
  imageUnscale: [number, number];
  /** GridLayer defaults to SCALAR — the uv wind field must say it's a vector. */
  imageType: "VECTOR";
  bounds: Bounds;
  /**
   * WeatherLayers GridStyle.WIND_BARB: glyph picked from the built-in barb
   * atlas by decoded speed, rotated to direction.
   *
   * UNITS — checked in the bundle, because the wording here used to say "0–100
   * kt" and that reads like an instruction to convert: the atlas declares
   * `iconBounds: [0, 51.444]`, and 51.444 m/s IS 100 kt. So it wants **metres
   * per second**, which is what the GFS u/v textures already decode to. Do NOT
   * scale these values into knots — that was tried on 2026-09-10 while chasing
   * calm-looking barbs under a damaging-wind warning, and it would have made
   * every barb 1.94× too strong.
   */
  style: "WIND_BARB";
  iconSize: number;
  iconColor: [number, number, number, number];
  opacity: number;
  visible: boolean;
}

export interface WindBarbOpts {
  /** Barb glyph colour as `#rrggbb`; defaults to white. */
  color?: string;
  iconSize?: number;
  /** Appended to the layer id so a base + its nests get unique ids (deck.gl). */
  idSuffix?: string;
}

/**
 * PURE props for a wind-barb GridLayer (windMode "barbs") from an explicit
 * entry + bounds — the same resolver seam as `vectorParticlePropsFromEntry`,
 * reading the same uv textures. Returns null when the entry has no
 * texture/unscale at this step. Opacity is fixed rather than the operator's
 * particle opacity: the wind sliders only style the particles look, and
 * director slides tone particles down to ~0.1 — barbs ARE the chart, so they
 * must stay readable.
 */
export function windBarbPropsFromEntry(
  entry: WeatherVariableManifest,
  variableId: string,
  fhr: number,
  bounds: Bounds,
  opts: WindBarbOpts = {},
): WindBarbProps | null {
  const image = entry.files[String(fhr)];
  const unscale = entry.vectorUnscale ?? entry.imageUnscale;
  if (!image || !unscale) return null;
  return {
    id: `${variableId}-barbs-${fhr}${opts.idSuffix ?? ""}`,
    image,
    imageUnscale: unscale,
    imageType: "VECTOR",
    bounds,
    style: "WIND_BARB",
    iconSize: opts.iconSize ?? 40,
    iconColor: hexToRgba(opts.color),
    opacity: 0.9,
    visible: true,
  };
}

/**
 * Parse a `#rrggbb` (or `#rgb`) hex string into an opaque RGBA tuple. Falls back
 * to white on anything unparseable so the particle layer always renders. Pure.
 */
export function hexToRgba(hex?: string): [number, number, number, number] {
  // Memoised per input so the same hex yields the same tuple: WeatherLayers'
  // ParticleLayer diffs `color` by reference and re-runs its setup on a change.
  const cached = rgbaCache.get(hex ?? "");
  if (cached) return cached;
  const out = parseHexRgba(hex);
  rgbaCache.set(hex ?? "", out);
  return out;
}
const rgbaCache = new Map<string, [number, number, number, number]>();
function parseHexRgba(hex?: string): [number, number, number, number] {
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
  /** Cross-fade ramp drawn on the GPU (BreatheExtension `ramp`), or null. Attached
   *  by the layer builder, not here — this file stays deck-free. */
  fade?: import("./breathe-extension").BreatheSpec | null;
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

/**
 * Map a normalised 0..1 palette onto a physical [min,max] domain.
 *
 * Memoised per (palette, domain): WeatherLayers compares `palette` by
 * reference and re-parses the ramp, redraws its 256-px canvas and uploads a new
 * GPU texture (`_updatePalette`) whenever it changes — so a fresh array per
 * layer build re-baked every raster/contour palette on every rebuild of the
 * layer stack. `getPalette` returns module constants, so keying on identity is
 * exact.
 */
const scaledPaletteCache = new WeakMap<Palette, Map<string, Palette>>();
export function scalePaletteToDomain(palette: Palette, domain?: [number, number]): Palette {
  if (!domain) return palette;
  const [min, max] = domain;
  const key = `${min}|${max}`;
  let byDomain = scaledPaletteCache.get(palette);
  if (!byDomain) {
    byDomain = new Map();
    scaledPaletteCache.set(palette, byDomain);
  }
  let scaled = byDomain.get(key);
  if (!scaled) {
    scaled = palette.map(([stop, hex]) => [min + stop * (max - min), hex] as [number, string]);
    byDomain.set(key, scaled);
  }
  return scaled;
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

export interface ElevationContourProps {
  id: string;
  image: string;
  imageUnscale: [number, number] | undefined;
  bounds: Bounds;
  interval: number;
  /** Thicker, emphasised contour every N metres. */
  majorInterval: number;
  width: number;
  opacity: number;
  /** Colour-by-height ramp (colorMode "elevation"); mutually exclusive with `color`. */
  palette?: Palette;
  /** Flat line colour RGBA (colorMode "default"/"custom"); else `palette` is used. */
  color?: [number, number, number, number];
}

/** How the contour LINES are coloured, plus their width/opacity/spacing. */
export interface ElevationLineOpts {
  colorMode?: "default" | "elevation" | "custom";
  /** Hex `#rrggbb` for the "custom" flat colour. */
  color?: string;
  width?: number;
  opacity?: number;
  interval?: number;
  majorInterval?: number;
}

/** Flat warm-white used by the "default" colour mode — reads on land and sea. */
const DEFAULT_ELEVATION_LINE_RGBA: [number, number, number, number] = [255, 224, 178, 255];

/**
 * PURE props for the static elevation contour LINE overlay. Unlike pressure this
 * is NOT forecast-hour indexed — terrain never changes, so it is baked once at
 * fhr 0 and we ignore the timeline (pick the single stored texture regardless of
 * `fhr`). Lines are either a flat colour ("default"/"custom") or coloured by
 * height ("elevation" → the brighter `elevation_line` ramp). Returns null when no
 * elevation texture has been baked yet (`yarn refresh:elevation` not run).
 */
export function elevationProps(
  manifest: WeatherManifest,
  opts: ElevationLineOpts = {},
): { contour: ElevationContourProps } | null {
  const entry = manifest.variables.elevation;
  if (!entry) return null;
  // Static: the single baked step (key "0"), or whatever the only key is.
  const image = entry.files["0"] ?? Object.values(entry.files)[0];
  if (!image) return null;
  const meta = getVariable("elevation");
  const domain = entry.domain ?? meta?.domain;
  const mode = opts.colorMode ?? "elevation";
  const contour: ElevationContourProps = {
    id: "elevation-contour",
    image,
    imageUnscale: entry.imageUnscale,
    bounds: manifestBounds(manifest),
    interval: opts.interval ?? 250,
    majorInterval: opts.majorInterval ?? 1000,
    width: opts.width ?? 1.5,
    opacity: opts.opacity ?? 1,
  };
  if (mode === "elevation") {
    // WeatherLayers maps the ramp against the DECODED metre value.
    contour.palette = scalePaletteToDomain(getPalette("elevation_line"), domain);
  } else if (mode === "custom") {
    contour.color = hexToRgba(opts.color);
  } else {
    contour.color = DEFAULT_ELEVATION_LINE_RGBA;
  }
  return { contour };
}

export interface CityScatterProps {
  id: string;
  data: City[];
  getPosition: (c: City) => [number, number];
  getRadius: (c: City) => number;
  getFillColor: (c: City) => [number, number, number, number];
  /** The globe zoom at which this city's dot should appear (same threshold as its label). */
  getFilterValue: (c: City) => number;
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
      // Same population/capital-driven threshold as the name label — so a
      // whole-globe view isn't a snowstorm of tiny towns' dots, and a dot only
      // appears once you've zoomed in far enough to read its name anyway.
      getFilterValue: (c) => cityLabelMinZoom(c),
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

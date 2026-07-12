/**
 * The client-facing manifest: the exact JSON shape returned by
 * `GET /api/weather/manifest`. It is derived from a published WeatherRun, with
 * each variable's `files` map rewritten from texture ids to fetchable URLs
 * (`/api/weather/tex/<id>`). The browser never reads Mongo or GRIB directly.
 */
import type { WeatherEncoding, iWeatherStep } from "./db/weather-run-model";

export interface WeatherVariableManifest {
  encoding: WeatherEncoding;
  units: string;
  domain?: [number, number];
  palette?: string;
  imageUnscale?: [number, number];
  /** Vector ("uv"): symmetric per-channel decode range [-max,max]. */
  vectorUnscale?: [number, number];
  // ── Source tagging (multi-supplier; optional so single-source stays valid) ──
  sourceId?: string;
  resolutionDeg?: number;
  bbox?: [number, number, number, number];
  priority?: number;
  /**
   * Regional-nest zoom floor (only on entries inside `nests`). The client shows
   * this nest when camera zoom ≥ `minZoom` and the view centre is inside `bbox`.
   * Absent → the client derives a default from `resolutionDeg`.
   */
  minZoom?: number;
  /** ISO run/init time of the source run this variable came from. */
  runTimeUtc?: string;
  /** ISO time the worker finished baking this variable's source run. */
  generatedAt?: string;
  /** forecast-hour (string) → texture URL */
  files: Record<string, string>;
  /**
   * Regional high-res overlays for this variable, each with its own `bbox` /
   * `minZoom` / `files`, sorted coarsest→finest (finest renders last, on top of
   * the global base above). Present only when a regional source supplies this
   * variable. A base with empty `files` but a populated `nests` array is a
   * NEST-ONLY variable (e.g. radar): nothing renders globally, only in-region.
   */
  nests?: WeatherVariableManifest[];
}

export interface WeatherManifest {
  model: string;
  /** ISO run/cycle time. */
  run: string;
  generatedAt?: string;
  /** [west, south, east, north]. */
  bounds: number[];
  grid: { width: number; height: number; res: number };
  steps: iWeatherStep[];
  variables: Record<string, WeatherVariableManifest>;
}

/**
 * Build the texture URL the browser should fetch for a stored texture id.
 * The `.png` suffix is required so the client's image loader (loaders.gl, via
 * WeatherLayers) can select the PNG decoder by extension; the route strips it.
 */
export const textureUrl = (id: string): string => `/api/weather/tex/${id}.png`;

/**
 * Redis key the `/api/weather/manifest` route caches the composed manifest under
 * (a static key — the composition is identical for every client until a run
 * publishes). Exported so the WORKER can DELETE it on publish, dropping the up-to
 * FEED_CACHE_TTL_SEC lag between a bake finishing and the map showing it. Shared
 * constant so the route and the buster can never drift.
 */
export const MANIFEST_CACHE_KEY = "feed:v1:manifest";

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
  /** forecast-hour (string) → texture URL */
  files: Record<string, string>;
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

// grib/bake.ts
// Shared bake constants + per-variable decode (imageUnscale) ranges.
//
// `imageUnscale` is the PHYSICAL range that the 0..255 byte values decode back
// to. It must be wider than the registry `domain` (the colour-ramp range) so the
// encoded PNG never clips real physical extremes.

import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";

export const GFS_GRID = { width: 1440, height: 721, res: 0.25 } as const;
export const GFS_BOUNDS = [-180, -90, 180, 90] as const;

/** Symmetric wind component encode range (m/s). */
export const WIND_IMAGE_UNSCALE: [number, number] = [-128, 128];

/**
 * Per-scalar-variable decode ranges (in the baked/display unit). Chosen wider
 * than the registry colour domain to safely cover physical extremes.
 */
export const SCALAR_IMAGE_UNSCALE: Record<string, [number, number]> = {
  temp: [-90, 60], // °C
  humidity: [0, 100], // %
  rain: [0, 50], // mm/h (PRATE; heavy rain ~10-50)
  storm: [0, 8000], // J/kg CAPE
  gust: [0, 120], // m/s
  pressure: [870, 1085], // hPa MSLP
};

/** Resolve the decode range for a variable, defaulting to its colour domain. */
export function imageUnscaleFor(variableId: string): [number, number] {
  const explicit = SCALAR_IMAGE_UNSCALE[variableId];
  if (explicit) return explicit;
  const reg = VARIABLE_REGISTRY[variableId];
  if (reg?.domain) return [reg.domain[0], reg.domain[1]];
  return [0, 1];
}

export interface BakeResult {
  buffer: Buffer;
  imageUnscale: [number, number];
  domain: [number, number];
  encoding: "uv" | "scalar";
}

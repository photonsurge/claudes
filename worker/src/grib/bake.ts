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
 * Per-vector-variable symmetric encode range [-max,max] (in the baked unit),
 * applied to BOTH channels (R=u, G=v). Stored in the manifest as `vectorUnscale`
 * so the client decodes u/v back. Wind reuses the wide ±128 m/s range; ocean
 * currents are slow (<~2.5 m/s even in the Gulf Stream) so ±3 m/s gives usable
 * 8-bit resolution.
 */
export const VECTOR_IMAGE_UNSCALE: Record<string, [number, number]> = {
  wind: WIND_IMAGE_UNSCALE,
  current: [-3, 3], // m/s surface current
};

/** Resolve the symmetric vector encode range for a uv variable. */
export function vectorImageUnscaleFor(variableId: string): [number, number] {
  return VECTOR_IMAGE_UNSCALE[variableId] ?? WIND_IMAGE_UNSCALE;
}

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
  sst: [-5, 40], // °C (water temp; wider than the -2..32 colour domain)
  cloud: [0, 100], // %
  snow: [0, 500], // cm (deep snowpack; SNOD baked metres → cm)
  wave: [0, 30], // m significant wave height (record seas ~20m)
  salinity: [25, 40], // PSU (open ocean ~32-37; wider to cover coastal/brine)
  // Static terrain, metres. Challenger Deep (~−10,900) → Everest (~8,850). 8-bit
  // grayscale over this 20 km span quantises to ~78 m/step, so the finest usable
  // contour interval is ~100 m (coarser reads cleaner on a broadcast globe).
  elevation: [-11000, 9000],
  // dBZ. Wider than the 5..75 colour domain so hail cores (>75) and the sub-5
  // clear-air floor still decode without clipping. The floor + MRMS no-coverage
  // sentinels (-999/-99) bake TRANSPARENT via radarKeepMask, so the exact low end
  // only needs to hold light/near-zero echo (values below ~5 dBZ are masked out).
  radar: [-30, 80],
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

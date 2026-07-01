// grib/bakeVector.ts
// Orchestrate vector (uv) texture baking for ANY 2-component field: roll
// longitude -> mask nodata -> encode R=u/G=v PNG. `bakeWind` is the special case
// of this with no mask (wind is defined everywhere); ocean `current` uses the
// same path but bakes land/undefined transparent (alpha 0).
//
// Values are expected already in the baked/display unit (m/s for both wind and
// RTOFS currents — no unit conversion needed).

import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import { encodeVectorPng, rollLongitude } from "./encode";
import { vectorImageUnscaleFor, type BakeResult } from "./bake";

/** wgrib2 -bin writes UNDEFINED (bitmap-masked) points as ~9.999e20. */
const GRIB_UNDEFINED = 1e20;

/**
 * Keep mask for a vector field: drop any pixel where either component is
 * non-finite or GRIB-undefined (how RTOFS land points come through). Optionally
 * intersect with a sea/land mask. Returns undefined when nothing is dropped and
 * no side mask is requested, so clean fields (wind) bake fully opaque as before.
 */
export function vectorKeepMask(
  u: Float32Array,
  v: Float32Array,
  opts: { maskSide?: "sea" | "land"; land?: Float32Array } = {},
): Uint8Array | undefined {
  const { maskSide, land } = opts;
  const keep = new Uint8Array(u.length);
  let dropped = false;
  for (let i = 0; i < u.length; i++) {
    let ok =
      Number.isFinite(u[i]) &&
      Number.isFinite(v[i]) &&
      Math.abs(u[i]) < GRIB_UNDEFINED &&
      Math.abs(v[i]) < GRIB_UNDEFINED;
    if (ok && maskSide && land) {
      const isLand = land[i] >= 0.5;
      ok = maskSide === "land" ? isLand : !isLand;
    }
    keep[i] = ok ? 1 : 0;
    if (!ok) dropped = true;
  }
  if (!dropped && !maskSide) return undefined;
  return keep;
}

export interface BakeVectorArgs {
  variableId: string;
  u: Float32Array;
  v: Float32Array;
  width: number;
  height: number;
  /** Restrict to sea/land (e.g. currents = sea). Needs `landValues`. */
  maskSide?: "sea" | "land";
  /** Land-sea mask grid (1 = land), pre-roll aligned with u/v. */
  landValues?: Float32Array;
  /** Skip the 0..360 → −180..180 roll for already-rolled sources (regrid/mosaic). */
  preRolled?: boolean;
}

export async function bakeVector({
  variableId,
  u,
  v,
  width,
  height,
  maskSide,
  landValues,
  preRolled,
}: BakeVectorArgs): Promise<BakeResult> {
  const reg = VARIABLE_REGISTRY[variableId];
  if (!reg) throw new Error(`Unknown variable: ${variableId}`);

  const ru = preRolled ? u : rollLongitude(u, width, height);
  const rv = preRolled ? v : rollLongitude(v, width, height);
  const rolledLand = landValues && !preRolled ? rollLongitude(landValues, width, height) : landValues;
  const keep = vectorKeepMask(ru, rv, { maskSide, land: rolledLand });

  const imageUnscale = vectorImageUnscaleFor(variableId);
  const buffer = await encodeVectorPng(ru, rv, width, height, imageUnscale, keep);

  return {
    buffer,
    imageUnscale,
    domain: [reg.domain[0], reg.domain[1]],
    encoding: "uv",
  };
}

// grib/bakeScalar.ts
// Orchestrate scalar texture baking: wgrib2 grid -> unit convert -> de-accumulate
// (if accumulated) -> roll longitude -> PNG.

import {
  VARIABLE_REGISTRY,
  kelvinToCelsius,
  metersToCm,
  paToHpa,
} from "@photonsurge/shared/variables";
import { deaccumulate, encodeScalarPng, rollLongitude } from "./encode";
import { imageUnscaleFor, type BakeResult } from "./bake";

/**
 * Convert a raw GFS scalar grid into the variable's baked/display unit, in place
 * on a new Float32Array. Mirrors the unit discipline in VARIABLE_REGISTRY:
 *  - temp:  K -> °C
 *  - pressure: Pa -> hPa
 *  - rain:  PRATE kg m⁻² s⁻¹ (= mm/s) -> mm/h
 *  - sst:   WTMP K -> °C
 *  - snow:  SNOD m -> cm
 *  - dewpoint: DPT K -> °C
 *  - soil:  SOILW 0..1 volumetric fraction -> %
 *  - visibility: VIS m -> km
 *  - others: identity (RH already %, CAPE/CIN J/kg, GUST m/s, TCDC %).
 */
export function convertScalarUnits(variableId: string, values: Float32Array): Float32Array {
  const out = new Float32Array(values.length);
  switch (variableId) {
    case "temp":
    case "sst":
    case "dewpoint":
    case "feelslike":
      for (let i = 0; i < values.length; i++) out[i] = kelvinToCelsius(values[i]);
      return out;
    case "pressure":
      for (let i = 0; i < values.length; i++) out[i] = paToHpa(values[i]);
      return out;
    case "rain":
      for (let i = 0; i < values.length; i++) out[i] = values[i] * 3600;
      return out;
    case "snow":
      for (let i = 0; i < values.length; i++) out[i] = metersToCm(values[i]);
      return out;
    case "soil":
      for (let i = 0; i < values.length; i++) out[i] = values[i] * 100;
      return out;
    case "visibility":
      for (let i = 0; i < values.length; i++) out[i] = values[i] / 1000;
      return out;
    default:
      out.set(values);
      return out;
  }
}

/** wgrib2 -bin writes UNDEFINED (bitmap-masked) points as ~9.999e20. */
const GRIB_UNDEFINED = 1e20;

/**
 * Build the per-pixel keep mask (1 = data, 0 = nodata→transparent) for a scalar
 * from the variable's `mask`/`minVisible` config, plus always dropping
 * GRIB-undefined / non-finite points (how bitmap-masked fields like wave height
 * get their land transparent). `land` is the GFS land-sea mask grid (1 = land,
 * 0 = sea), already in the SAME row/col order as `physical` (i.e. roll both
 * before calling, or neither). Returns undefined when nothing needs masking, so
 * clean global fields bake fully opaque as before.
 */
export function scalarKeepMask(
  variableId: string,
  physical: Float32Array,
  land?: Float32Array,
): Uint8Array | undefined {
  const reg = VARIABLE_REGISTRY[variableId];
  const maskSide = reg?.gfs?.mask;
  const minVisible = reg?.gfs?.minVisible;

  const keep = new Uint8Array(physical.length);
  let dropped = false;
  for (let i = 0; i < physical.length; i++) {
    const v = physical[i];
    let ok = Number.isFinite(v) && Math.abs(v) < GRIB_UNDEFINED;
    if (ok && maskSide && land) {
      const isLand = land[i] >= 0.5;
      ok = maskSide === "land" ? isLand : !isLand;
    }
    if (ok && minVisible !== undefined && !(v >= minVisible)) ok = false;
    keep[i] = ok ? 1 : 0;
    if (!ok) dropped = true;
  }
  // No config and nothing dropped → no mask needed (opaque, as before).
  if (!dropped && !maskSide && minVisible === undefined) return undefined;
  return keep;
}

export interface BakeScalarArgs {
  variableId: string;
  /** Current step's raw grid (in GFS native units). */
  values: Float32Array;
  width: number;
  height: number;
  /** Previous step's raw accumulated grid (accumulated vars only). */
  prevValues?: Float32Array;
  /** Hours between this step and the previous (accumulated vars only). */
  deltaHours?: number;
  /** GFS land-sea mask grid (1 = land, 0 = sea), masked vars only. */
  landValues?: Float32Array;
  /**
   * GFS data is 0..360 and gets rolled to −180..180 at bake. Regridded/mosaicked
   * sources (RTOFS curvilinear regrid, wave tile mosaic) already sit at −180..180,
   * so pass `preRolled: true` to skip the roll.
   */
  preRolled?: boolean;
  /**
   * Skip the GFS-unit conversion (K→°C etc). RTOFS netCDF already delivers
   * display units (SST in °C, salinity in PSU), so it bakes with this set — the
   * K→°C in `convertScalarUnits` would otherwise double-convert SST.
   */
  skipUnitConvert?: boolean;
}

export async function bakeScalar({
  variableId,
  values,
  width,
  height,
  prevValues,
  deltaHours,
  landValues,
  preRolled,
  skipUnitConvert,
}: BakeScalarArgs): Promise<BakeResult> {
  const reg = VARIABLE_REGISTRY[variableId];
  if (!reg) throw new Error(`Unknown variable: ${variableId}`);

  let physical: Float32Array;
  if (reg.gfs?.accumulated) {
    // APCP-style: de-accumulate raw accumulation totals into a per-hour rate.
    physical = deaccumulate(values, prevValues, deltaHours ?? 0);
  } else if (skipUnitConvert) {
    physical = Float32Array.from(values);
  } else {
    physical = convertScalarUnits(variableId, values);
  }

  const rolled = preRolled ? physical : rollLongitude(physical, width, height);
  // Roll the land mask the same way so it lines up with the rolled values.
  const rolledLand = landValues && !preRolled ? rollLongitude(landValues, width, height) : landValues;
  const keep = scalarKeepMask(variableId, rolled, rolledLand);
  const imageUnscale = imageUnscaleFor(variableId);
  const buffer = await encodeScalarPng(rolled, width, height, imageUnscale, keep);

  return {
    buffer,
    imageUnscale,
    domain: [reg.domain[0], reg.domain[1]],
    encoding: "scalar",
  };
}

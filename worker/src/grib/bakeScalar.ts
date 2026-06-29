// grib/bakeScalar.ts
// Orchestrate scalar texture baking: wgrib2 grid -> unit convert -> de-accumulate
// (if accumulated) -> roll longitude -> PNG.

import {
  VARIABLE_REGISTRY,
  kelvinToCelsius,
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
 *  - others: identity (RH already %, CAPE J/kg, GUST m/s).
 */
export function convertScalarUnits(variableId: string, values: Float32Array): Float32Array {
  const out = new Float32Array(values.length);
  switch (variableId) {
    case "temp":
      for (let i = 0; i < values.length; i++) out[i] = kelvinToCelsius(values[i]);
      return out;
    case "pressure":
      for (let i = 0; i < values.length; i++) out[i] = paToHpa(values[i]);
      return out;
    case "rain":
      for (let i = 0; i < values.length; i++) out[i] = values[i] * 3600;
      return out;
    default:
      out.set(values);
      return out;
  }
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
}

export async function bakeScalar({
  variableId,
  values,
  width,
  height,
  prevValues,
  deltaHours,
}: BakeScalarArgs): Promise<BakeResult> {
  const reg = VARIABLE_REGISTRY[variableId];
  if (!reg) throw new Error(`Unknown variable: ${variableId}`);

  let physical: Float32Array;
  if (reg.gfs.accumulated) {
    // APCP-style: de-accumulate raw accumulation totals into a per-hour rate.
    physical = deaccumulate(values, prevValues, deltaHours ?? 0);
  } else {
    physical = convertScalarUnits(variableId, values);
  }

  const rolled = rollLongitude(physical, width, height);
  const imageUnscale = imageUnscaleFor(variableId);
  const buffer = await encodeScalarPng(rolled, width, height, imageUnscale);

  return {
    buffer,
    imageUnscale,
    domain: [reg.domain[0], reg.domain[1]],
    encoding: "scalar",
  };
}

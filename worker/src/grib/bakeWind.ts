// grib/bakeWind.ts
// Orchestrate wind (uv) texture baking: wgrib2 grids -> roll longitude -> PNG.
// Wind is already in m/s in GFS, so no unit conversion is needed.

import { VARIABLE_REGISTRY } from "@photonsurge/shared/variables";
import { encodeWindPng, rollLongitude } from "./encode";
import { WIND_IMAGE_UNSCALE, type BakeResult } from "./bake";

export interface BakeWindArgs {
  u: Float32Array;
  v: Float32Array;
  width: number;
  height: number;
}

export async function bakeWind({ u, v, width, height }: BakeWindArgs): Promise<BakeResult> {
  const ru = rollLongitude(u, width, height);
  const rv = rollLongitude(v, width, height);
  const buffer = await encodeWindPng(ru, rv, width, height, WIND_IMAGE_UNSCALE);
  const domain = VARIABLE_REGISTRY.wind.domain;
  return {
    buffer,
    imageUnscale: WIND_IMAGE_UNSCALE,
    domain: [domain[0], domain[1]],
    encoding: "uv",
  };
}

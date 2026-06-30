// weather/bakeVariableStep.ts
// Download + bake a single variable at a single forecast hour: build the NOMADS
// URL, fetch the GRIB subset to a temp file, extract the field(s) with wgrib2 and
// bake the wind (uv) or scalar texture. Returns the PNG buffer + meta + the temp
// GRIB path so the caller can clean up / chain accumulation.

import type { iVariableMeta } from "@photonsurge/shared/variables";

import { buildNomadsUrl, padFhr } from "../sources/gfs";
import { extractField } from "../grib/wgrib2";
import { GFS_GRID } from "../grib/bake";
import { bakeWind } from "../grib/bakeWind";
import { bakeScalar } from "../grib/bakeScalar";
import { downloadToTemp } from "./download";

export interface BakeVariableStepResult {
  buffer: Buffer;
  imageUnscale: [number, number];
  domain: [number, number];
  encoding: "uv" | "scalar";
  gribPath: string;
}

/** Download + bake a single variable at a single fhr. Returns the PNG buffer + meta. */
export async function bakeVariableStep(
  variable: iVariableMeta,
  date: string,
  cycle: string,
  fhr: number,
  prevAccumPath: string | undefined,
  stepHours: number,
): Promise<BakeVariableStepResult> {
  // Masked scalars (SST/snow) also pull the GFS land-sea mask (LAND:surface) in
  // the same subset so we can bake the off-side as transparent.
  const masked = variable.encoding === "scalar" && !!variable.gfs.mask;
  const url = buildNomadsUrl({
    date,
    cycle,
    fhr,
    vars: masked ? [...variable.gfs.vars, "LAND"] : variable.gfs.vars,
    levels: masked ? [...variable.gfs.levels, "surface"] : variable.gfs.levels,
    product: variable.gfs.product,
  });
  const gribPath = await downloadToTemp(url, `${variable.id}.f${padFhr(fhr)}.grib2`);

  if (variable.encoding === "uv") {
    const u = await extractField({ gribPath, match: `:${variable.gfs.vars[0]}:`, ...GFS_GRID });
    const v = await extractField({ gribPath, match: `:${variable.gfs.vars[1]}:`, ...GFS_GRID });
    const res = await bakeWind({ u: u.values, v: v.values, width: u.width, height: u.height });
    return { ...res, gribPath };
  }

  const field = await extractField({ gribPath, match: `:${variable.gfs.vars[0]}:`, ...GFS_GRID });
  let prevValues: Float32Array | undefined;
  let deltaHours: number | undefined;
  if (variable.gfs.accumulated && prevAccumPath) {
    const prev = await extractField({ gribPath: prevAccumPath, match: `:${variable.gfs.vars[0]}:`, ...GFS_GRID });
    prevValues = prev.values;
    deltaHours = stepHours;
  }
  let landValues: Float32Array | undefined;
  if (masked) {
    const land = await extractField({ gribPath, match: ":LAND:", ...GFS_GRID });
    landValues = land.values;
  }
  const res = await bakeScalar({
    variableId: variable.id,
    values: field.values,
    width: field.width,
    height: field.height,
    prevValues,
    deltaHours,
    landValues,
  });
  return { ...res, gribPath };
}

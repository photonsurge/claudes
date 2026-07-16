// weather/rtofsDepth.ts
// NOAA RTOFS temperature-at-depth (netCDF -> cdo sellevel+remap -> GRIB2 -> bake).
// Sibling to `ingestRtofs` in multiSource.ts, but published as its own
// "rtofs-depth" model/run so this pipeline's own ~816MB/day download and
// idempotency check don't couple to the surface (sst/salinity/current) run.
// Surface (0m) reuses the existing `sst` variable — no depth-cube pull for it.

import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakePool";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import { alreadyPublished, type IngestResult } from "./multiSource";
import { netcdfToGrib2 } from "../netcdf/toGrib2";
import { RTOFS_TARGET_GRID, RTOFS_TARGET_BOUNDS, RTOFS_CDO_REMAP_GRID } from "../sources/rtofs";
import {
  buildRtofsDepthUrl,
  rtofsDepthLatestAvailableRun,
  RTOFS_DEPTH_LEVELS_M,
  RTOFS_DEPTH_VARIABLE_IDS,
} from "../sources/rtofsDepth";

const TAG = "job:weather:source";

/** netCDF var name (cdo -selname) for the 3-D temperature cube. */
const NC_VAR = "temperature";

/**
 * No wgrib2 `-match` token: verified live (2026) that cdo can NOT map the
 * `temperature` netCDF var to a recognized GRIB2 parameter (unlike `sst`) —
 * it lands as a generic/unnamed parameter (`discipline=255 parmcat=255
 * parm=1`), so there's no stable shortName to match on. Each per-depth
 * GRIB2 file we produce carries exactly one record anyway (single var,
 * single level, single time step via `-selname`+`-sellevel`), and
 * `extractField` dumps the sole record when `match` is omitted.
 */

export async function ingestRtofsDepth(now = new Date()): Promise<IngestResult> {
  const source = getSource("rtofs-depth")!;
  const run = await rtofsDepthLatestAvailableRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }
  const W = RTOFS_TARGET_GRID.width;
  const H = RTOFS_TARGET_GRID.height;
  const variables: Record<string, BakedVariable> = {};
  const tmp: string[] = [];
  try {
    await nomadsGate();
    const ncPath = await downloadToTemp(buildRtofsDepthUrl({ date: run.date, hour: 24, kind: "n" }), "rtofs.3dz.nc");
    tmp.push(ncPath);
    for (const depth of RTOFS_DEPTH_LEVELS_M) {
      const variableId = RTOFS_DEPTH_VARIABLE_IDS[depth];
      const gribPath = `${ncPath}.${depth}.grb2`;
      try {
        await netcdfToGrib2({
          inPath: ncPath,
          outPath: gribPath,
          selnames: [NC_VAR],
          sellevel: depth,
          remapGrid: RTOFS_CDO_REMAP_GRID,
        });
        tmp.push(gribPath);
        const { values } = await extractField({ gribPath, width: W, height: H });
        const res = await bakeScalar({ variableId, values, width: W, height: H, preRolled: true, skipUnitConvert: true });
        variables[variableId] = {
          meta: {
            encoding: "scalar",
            units: "°C",
            domain: res.domain,
            palette: "sst",
            imageUnscale: res.imageUnscale,
            sourceId: source.id,
            resolutionDeg: source.resolutionDeg,
            bbox: source.bbox,
            priority: source.priority,
          },
          buffers: { 0: res.buffer },
        };
      } catch (err) {
        log(TAG, "rtofs-depth: bake failed", { variableId, depth, err: String(err) });
      }
    }
    if (Object.keys(variables).length === 0) {
      throw new Error("no RTOFS depth variables baked (cdo/wgrib2 installed? GRIB2 token correct?)");
    }
    const { runId } = await publishSourceRun({
      model: source.id,
      runDate: run.runDate,
      bounds: [...RTOFS_TARGET_BOUNDS],
      grid: { width: W, height: H, res: RTOFS_TARGET_GRID.res },
      steps: [{ fhr: 0, validTime: run.runDate.toISOString() }],
      variables,
    });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

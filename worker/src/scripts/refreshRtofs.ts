/**
 * Manual one-shot NOAA Global RTOFS ocean ingest — `yarn refresh:rtofs`.
 * Downloads the latest global 2-D surface `prog` netCDF, reads SST / salinity /
 * surface currents off the tripolar grid, regrids each onto a regular global
 * lat-lon grid, bakes them (SST/salinity scalar, currents vector) and publishes a
 * run with model="rtofs". Bakes a single analysis frame (fhr 0) — ocean surface
 * fields evolve slowly, so one frame carries the globe.
 *
 * Needs: network to NOMADS + `netcdfjs` (`yarn install` first — declared in
 * package.json). ⚠️ Confirm the netCDF variable/coord names in sources/rtofs.ts
 * against `ncdump -h` on a real file before trusting output.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getSource } from "@photonsurge/shared/sources";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
import { downloadToTemp, cleanupTemp, headOk } from "../weather/download";
import { publishSourceRun, type BakedVariable } from "../weather/publishSourceRun";
import { readCurvilinearField } from "../netcdf/reader";
import { regridCurvilinear, fillPinholes, type RegularGridSpec } from "../regrid/curvilinear";
import {
  buildRtofsUrl, rtofsLatestAvailableRun,
  RTOFS_NETCDF_VARS, RTOFS_COORD_VARS, RTOFS_TARGET_GRID, RTOFS_TARGET_BOUNDS,
} from "../sources/rtofs";

const GRID: RegularGridSpec = {
  width: RTOFS_TARGET_GRID.width, height: RTOFS_TARGET_GRID.height, bounds: RTOFS_TARGET_BOUNDS,
};
type SourceTag = "sourceId" | "resolutionDeg" | "bbox" | "priority";
const bakeMeta = (
  source: NonNullable<ReturnType<typeof getSource>>,
  extra: Omit<BakedVariable["meta"], SourceTag>,
): BakedVariable["meta"] => ({
  sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority, ...extra,
});

(async () => {
  const source = getSource("rtofs")!;
  const run = await rtofsLatestAvailableRun(new Date(), headOk);
  console.log(`refresh:rtofs — run ${run.date}`);

  const variables: Record<string, BakedVariable> = {};
  const tmp: string[] = [];
  // Cache each bundle's downloaded file path once (all its vars share it).
  const bundlePath = new Map<string, string>();

  try {
    for (const [variableId, spec] of Object.entries(RTOFS_NETCDF_VARS)) {
      const url = buildRtofsUrl({ date: run.date, hour: 24, kind: "n", bundle: spec.bundle });
      let path = bundlePath.get(spec.bundle);
      if (!path) {
        try {
          path = await downloadToTemp(url, `rtofs.${spec.bundle}.nc`);
          tmp.push(path);
          bundlePath.set(spec.bundle, path);
        } catch (err) {
          console.warn(`  ${variableId}: download failed —`, String(err));
          continue;
        }
      }

      try {
        if (spec.encoding === "uv") {
          const u = await readCurvilinearField(path, { variable: spec.vars[0], latVar: RTOFS_COORD_VARS.lat, lonVar: RTOFS_COORD_VARS.lon });
          const v = await readCurvilinearField(path, { variable: spec.vars[1], latVar: RTOFS_COORD_VARS.lat, lonVar: RTOFS_COORD_VARS.lon });
          const ru = regridCurvilinear(u, GRID);
          const rv = regridCurvilinear({ values: v.values, lat: v.lat, lon: v.lon }, GRID);
          const res = await bakeVector({
            variableId, u: fillPinholes(ru, GRID.width, GRID.height), v: fillPinholes(rv, GRID.width, GRID.height),
            width: GRID.width, height: GRID.height, preRolled: true,
          });
          variables[variableId] = { meta: bakeMeta(source, { encoding: "uv", units: "m/s", domain: res.domain, palette: "current", imageUnscale: res.imageUnscale, vectorUnscale: res.imageUnscale }), buffers: { 0: res.buffer } };
        } else {
          const f = await readCurvilinearField(path, { variable: spec.vars[0], latVar: RTOFS_COORD_VARS.lat, lonVar: RTOFS_COORD_VARS.lon });
          const rg = fillPinholes(regridCurvilinear(f, GRID), GRID.width, GRID.height);
          // netCDF already in display units (°C / PSU) → skip the K→°C convert.
          const res = await bakeScalar({ variableId, values: rg, width: GRID.width, height: GRID.height, preRolled: true, skipUnitConvert: true });
          variables[variableId] = { meta: bakeMeta(source, { encoding: "scalar", units: variableId === "sst" ? "°C" : "PSU", domain: res.domain, palette: variableId, imageUnscale: res.imageUnscale }), buffers: { 0: res.buffer } };
        }
        console.log(`  ${variableId}: baked`);
      } catch (err) {
        console.warn(`  ${variableId}: read/regrid/bake failed —`, String(err));
      }
    }

    if (Object.keys(variables).length === 0) throw new Error("no RTOFS variables baked (netcdfjs installed? var names correct?)");

    const stepMeta = [{ fhr: 0, validTime: run.runDate.toISOString() }];
    const { runId } = await publishSourceRun({
      model: source.id, runDate: run.runDate, bounds: [...RTOFS_TARGET_BOUNDS],
      grid: { width: GRID.width, height: GRID.height, res: RTOFS_TARGET_GRID.res },
      steps: stepMeta, variables,
    });
    console.log(`refresh:rtofs — published run ${runId} with`, Object.keys(variables));
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
  process.exit(0);
})().catch((err) => {
  console.error("refreshRtofs fatal:", err);
  process.exit(1);
});

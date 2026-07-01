/**
 * Manual one-shot ECMWF IFS ingest — `yarn refresh:ifs`.
 * Pulls the latest available IFS 0.25° run, bakes the parity atmospheric vars
 * (temp, wind, pressure) on the same 1440×721 grid as GFS, and publishes a run
 * with model="ifs". GFS stays the default base; the public manifest composes
 * per-variable across models (IFS_AS_DEFAULT_BASE decides who wins for atmos).
 *
 * Needs: network to data.ecmwf.int + a wgrib2 build with CCSDS support (IFS is
 * CCSDS-packed; without it value extraction throws — see sources/ifs.ts).
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getSource } from "@photonsurge/shared/sources";
import { GFS_GRID, GFS_BOUNDS } from "../grib/bake";
import { extractField } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeWind } from "../grib/bakeWind";
import { downloadToTemp, cleanupTemp, headOk } from "../weather/download";
import { forecastSteps, cfg } from "../weather/config";
import { publishSourceRun, type BakedVariable } from "../weather/publishSourceRun";
import {
  buildIfsUrl,
  ifsLatestAvailableRun,
  ifsForecastSteps,
  IFS_VAR_MATCH,
} from "../sources/ifs";

const G = { width: GFS_GRID.width, height: GFS_GRID.height };

(async () => {
  const source = getSource("ifs")!;
  const run = await ifsLatestAvailableRun(new Date(), headOk);
  const runDate = new Date(Date.UTC(
    Number(run.date.slice(0, 4)), Number(run.date.slice(4, 6)) - 1, Number(run.date.slice(6, 8)),
    Number(run.cycle), 0, 0, 0,
  ));
  const { forecastHours, stepHours } = cfg();
  // Intersect our display window with the cycle's real step list.
  const allowed = new Set(ifsForecastSteps(run.cycle));
  const steps = forecastSteps(forecastHours, stepHours).filter((h) => allowed.has(h));
  console.log(`refresh:ifs — run ${runDate.toISOString()} cycle ${run.cycle}, steps`, steps);

  const variables: Record<string, BakedVariable> = {};
  const tmp: string[] = [];
  const tag = (id: string, meta: BakedVariable["meta"]) =>
    (variables[id] ??= { meta, buffers: {} });

  try {
    for (const fhr of steps) {
      const url = buildIfsUrl({ date: run.date, cycle: run.cycle, step: fhr });
      let path: string;
      try {
        path = await downloadToTemp(url, `ifs.f${fhr}.grib2`);
      } catch (err) {
        console.warn(`  f${fhr}: download failed, skipping —`, String(err));
        continue;
      }
      tmp.push(path);
      for (const [variableId, matches] of Object.entries(IFS_VAR_MATCH)) {
        try {
          if (variableId === "wind") {
            const u = await extractField({ gribPath: path, match: matches[0], ...G });
            const v = await extractField({ gribPath: path, match: matches[1], ...G });
            const res = await bakeWind({ u: u.values, v: v.values, width: G.width, height: G.height });
            tag("wind", { encoding: "uv", units: "m/s", domain: res.domain, palette: "wind",
              imageUnscale: res.imageUnscale, vectorUnscale: res.imageUnscale,
              sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
            }).buffers[fhr] = res.buffer;
          } else {
            const f = await extractField({ gribPath: path, match: matches[0], ...G });
            const res = await bakeScalar({ variableId, values: f.values, width: G.width, height: G.height });
            tag(variableId, { encoding: "scalar", units: variableId === "temp" ? "°C" : "hPa",
              domain: res.domain, palette: variableId, imageUnscale: res.imageUnscale,
              sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
            }).buffers[fhr] = res.buffer;
          }
        } catch (err) {
          console.warn(`  f${fhr} ${variableId}: extract/bake failed —`, String(err));
        }
      }
    }

    if (Object.keys(variables).length === 0) throw new Error("no IFS variables baked (CCSDS wgrib2? endpoint drift?)");

    const stepMeta = steps.map((fhr) => ({ fhr, validTime: new Date(runDate.getTime() + fhr * 3600 * 1000).toISOString() }));
    const { runId } = await publishSourceRun({
      model: source.id, runDate, bounds: [...GFS_BOUNDS], grid: { ...GFS_GRID }, steps: stepMeta, variables,
    });
    console.log(`refresh:ifs — published run ${runId} with`, Object.keys(variables));
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
  process.exit(0);
})().catch((err) => {
  console.error("refreshIfs fatal:", err);
  process.exit(1);
});

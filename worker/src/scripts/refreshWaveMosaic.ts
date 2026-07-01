/**
 * Manual one-shot GFS-Wave mosaic ingest — `yarn refresh:waves`.
 * NOAA has no genuine global 0.16° wave grid, so this fetches the regional tiles
 * (global.0p16 band + arctic + southern), regrids each onto a common global 1/6°
 * lat-lon grid (wgrib2 -new_grid), composites them by priority into one texture,
 * and publishes a run with model="gfswave-mosaic". The whole-planet global.0p25
 * stays as the coarse fallback (its own gfs-baked wave).
 *
 * Needs: network to NOMADS + wgrib2 (with -new_grid). Latest GFS-Wave cycle is
 * discovered via the GFS availability probe.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getSource } from "@photonsurge/shared/sources";
import { extractField } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { downloadToTemp, cleanupTemp, headOk } from "../weather/download";
import { forecastSteps, cfg } from "../weather/config";
import { publishSourceRun, type BakedVariable } from "../weather/publishSourceRun";
import { latestAvailableRun } from "../sources/gfs";
import {
  WAVE_TILES, WAVE_MATCH, WAVE_MOSAIC_GRID, WAVE_MOSAIC_NEWGRID, buildWaveTileUrl,
} from "../sources/gfswave";
import { regridTileToGlobal, mosaicByPriority, type MosaicTile } from "../merge/mosaic";

const GLOBAL_BOUNDS = [-180, -90, 180, 90];
const N = WAVE_MOSAIC_GRID.width * WAVE_MOSAIC_GRID.height;

(async () => {
  const source = getSource("gfswave-mosaic")!;
  const run = await latestAvailableRun(new Date(), headOk); // reuse GFS cycle timing
  const { forecastHours, stepHours } = cfg();
  const steps = forecastSteps(forecastHours, stepHours);
  console.log(`refresh:waves — cycle ${run.date}/${run.cycle}, steps`, steps);

  const wave: BakedVariable = {
    meta: {
      encoding: "scalar", units: "m", palette: "wave_height", domain: [0, 12],
      sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
    },
    buffers: {},
  };
  const tmp: string[] = [];

  try {
    for (const fhr of steps) {
      const tiles: MosaicTile[] = [];
      for (const tile of WAVE_TILES) {
        const url = buildWaveTileUrl({ date: run.date, cycle: run.cycle, fhr, grid: tile.grid });
        let path: string;
        try {
          path = await downloadToTemp(url, `wave.${tile.grid}.f${fhr}.grib2`);
        } catch (err) {
          console.warn(`  f${fhr} ${tile.grid}: download failed —`, String(err));
          continue;
        }
        tmp.push(path);
        try {
          const grid = await regridTileToGlobal({
            gribPath: path, outPath: `${path}.rg.grib2`, match: WAVE_MATCH,
            newgrid: WAVE_MOSAIC_NEWGRID, width: WAVE_MOSAIC_GRID.width, height: WAVE_MOSAIC_GRID.height,
          });
          tmp.push(`${path}.rg.grib2`);
          tiles.push({ values: grid.values, priority: tile.priority });
        } catch (err) {
          console.warn(`  f${fhr} ${tile.grid}: regrid failed —`, String(err));
        }
      }
      if (!tiles.length) continue;
      const composited = mosaicByPriority(tiles, N);
      // Tiles were regridded straight to −180..180, so skip the roll.
      const res = await bakeScalar({
        variableId: "wave", values: composited,
        width: WAVE_MOSAIC_GRID.width, height: WAVE_MOSAIC_GRID.height, preRolled: true,
      });
      wave.meta.imageUnscale = res.imageUnscale;
      wave.buffers[fhr] = res.buffer;
      console.log(`  f${fhr}: mosaicked ${tiles.length} tiles`);
    }

    if (Object.keys(wave.buffers).length === 0) throw new Error("no wave steps mosaicked");

    const runDate = new Date(Date.UTC(
      Number(run.date.slice(0, 4)), Number(run.date.slice(4, 6)) - 1, Number(run.date.slice(6, 8)),
      Number(run.cycle), 0, 0, 0,
    ));
    const stepMeta = Object.keys(wave.buffers).map(Number).sort((a, b) => a - b).map((fhr) => ({
      fhr, validTime: new Date(runDate.getTime() + fhr * 3600 * 1000).toISOString(),
    }));
    const { runId } = await publishSourceRun({
      model: source.id, runDate, bounds: GLOBAL_BOUNDS,
      grid: { width: WAVE_MOSAIC_GRID.width, height: WAVE_MOSAIC_GRID.height, res: WAVE_MOSAIC_GRID.res },
      steps: stepMeta, variables: { wave },
    });
    console.log(`refresh:waves — published run ${runId}`);
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
  process.exit(0);
})().catch((err) => {
  console.error("refreshWaveMosaic fatal:", err);
  process.exit(1);
});

// weather/iconGlobal.ts
// Ingest core for the DWD ICON global 13 km WORLDWIDE nest. Worker-only:
//   latest run → alreadyPublished guard → per field: download .bz2 → bunzip2 →
//   cdo remap (icosahedral → 0.125° regular global via DWD precomputed weights) →
//   wgrib2 extract on the 2880×1441 grid → bake (bakeVector wind pair, bakeScalar
//   temp/gust/humidity) → publishSourceRun tagged as the "icon-global" nest.
//
// WHY NOT ingestIconNest (iconCommon.ts)? The ICON-D2/EU nests use DWD's
// pre-interpolated regular-lat-lon twin, so they regrid with a single wgrib2
// `-new_grid`. The GLOBAL product is published ONLY on the native icosahedral
// mesh — wgrib2 can't decode it — so this ingest inserts a `cdo remap` step
// (DWD weights) before the wgrib2 extract. Everything downstream (the wind-pair
// bake, scalar bake, idempotency, throttle, temp cleanup, publish shape) mirrors
// iconCommon exactly.
//
// START WITH f0 ONLY: global 13 km is heavy. Fuller step ranges enable later via
// env `ICON_GLOBAL_FORECAST_HOURS` (default 0 → just the analysis step).

import { execFile } from "node:child_process";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { bunzip2ToFile, alreadyPublished, type IngestResult } from "./iconCommon";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import {
  buildIconGlobalUrl,
  buildIconGlobalRemapArgs,
  iconGlobalLatestAvailableRun,
  padIconGlobalStep,
  ICON_GLOBAL_VAR_TOKENS,
  ICON_GLOBAL_FIELD_MATCH,
  ICON_GLOBAL_CDO_REMAP,
} from "../sources/iconGlobal";

export type { IngestResult } from "./iconCommon";

const TAG = "job:weather:source";
const pexec = promisify(execFile);

/**
 * ICON global forecast steps. Live global 13 km nest → START WITH f0 ONLY by
 * default (heavy). Env `ICON_GLOBAL_FORECAST_HOURS` opens a wider hourly range
 * later (e.g. 6 → f0..f6) once the box can afford it.
 */
export function iconGlobalForecastSteps(): number[] {
  const max = Number(process.env.ICON_GLOBAL_FORECAST_HOURS || 0);
  const out: number[] = [];
  for (let h = 0; h <= max; h++) out.push(h);
  return out;
}

/**
 * Ensure the DWD target-grid + precomputed weights are on disk, returning their
 * paths. The archive (~50 MB) is STATIC (grid geometry, not per-run), so we fetch
 * it once and cache it under a stable dir; subsequent runs reuse it. Extraction
 * uses the system `tar` (which reads .bz2 via bunzip2 on PATH).
 *
 * VERIFY: the archive + inner filenames are current (see ICON_GLOBAL_CDO_REMAP).
 */
async function ensureRemapWeights(): Promise<{ gridPath: string; weightsPath: string }> {
  const cacheDir = join(tmpdir(), "wc-icon-global-cdo");
  const dir = join(cacheDir, ICON_GLOBAL_CDO_REMAP.archiveDir);
  const gridPath = join(dir, ICON_GLOBAL_CDO_REMAP.targetGridFile);
  const weightsPath = join(dir, ICON_GLOBAL_CDO_REMAP.weightsFile);

  const present = async (p: string) => {
    try { return (await stat(p)).size > 0; } catch { return false; }
  };
  if ((await present(gridPath)) && (await present(weightsPath))) {
    return { gridPath, weightsPath };
  }

  await mkdir(cacheDir, { recursive: true });
  await nomadsGate();
  const res = await fetch(ICON_GLOBAL_CDO_REMAP.weightsArchiveUrl);
  if (!res.ok) {
    throw new Error(`icon-global: weights archive download failed ${res.status} (${ICON_GLOBAL_CDO_REMAP.weightsArchiveUrl})`);
  }
  const archivePath = join(cacheDir, "ICON_GLOBAL2WORLD_0125_EASY.tar.bz2");
  await writeFile(archivePath, Buffer.from(await res.arrayBuffer()));
  // `tar -xjf` uses bunzip2; DWD packs the files under the archiveDir prefix.
  await pexec("tar", ["-xjf", archivePath, "-C", cacheDir], { maxBuffer: 16 * 1024 * 1024 });

  if (!((await present(gridPath)) && (await present(weightsPath)))) {
    throw new Error(
      `icon-global: expected ${ICON_GLOBAL_CDO_REMAP.targetGridFile} + ${ICON_GLOBAL_CDO_REMAP.weightsFile} under ${dir} after unpacking — VERIFY archive layout`,
    );
  }
  return { gridPath, weightsPath };
}

/**
 * cdo-remap ONE icosahedral GRIB2 field onto the 0.125° regular world grid, then
 * wgrib2-extract the (already −180..180 / regular) field for a `preRolled: true`
 * bake. Returns the Float32 grid.
 */
async function remapAndExtract(args: {
  inPath: string;
  match: string;
  gridPath: string;
  weightsPath: string;
  width: number;
  height: number;
}): Promise<Float32Array> {
  const outPath = `${args.inPath}.rg.grib2`;
  try {
    await pexec("cdo", buildIconGlobalRemapArgs({
      gridPath: args.gridPath,
      weightsPath: args.weightsPath,
      inPath: args.inPath,
      outPath,
    }), { maxBuffer: 64 * 1024 * 1024 });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error("`cdo` not installed — install the CDO climate tools (needed to remap ICON's icosahedral grid) before icon-global ingest");
    }
    throw err;
  }
  const field = await extractField({ gribPath: outPath, match: args.match, width: args.width, height: args.height });
  return field.values;
}

/**
 * Ingest the latest ICON global run and publish it as the "icon-global"
 * worldwide nest. Idempotent + throttled; temp files cleaned in `finally`.
 */
export async function ingestIconGlobal(now = new Date()): Promise<IngestResult> {
  const source = getSource("icon-global")!;
  const run = await iconGlobalLatestAvailableRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const width = source.dims!.width;
  const height = source.dims!.height;
  const res = source.resolutionDeg;

  const { gridPath, weightsPath } = await ensureRemapWeights();

  const variables: Record<string, BakedVariable> = {};
  const tag = (id: string, meta: BakedVariable["meta"]) => (variables[id] ??= { meta, buffers: {} });
  const tmp: string[] = [];

  /** Download + bunzip2 one DWD field for a step; returns the plain GRIB2 path. */
  const fetchField = async (field: string, step: number): Promise<string> => {
    await nomadsGate();
    const bz = await downloadToTemp(
      buildIconGlobalUrl({ date: run.date, cycle: run.cycle, step, field }),
      `icon-global.${field}.f${padIconGlobalStep(step)}.grib2.bz2`,
    );
    tmp.push(bz);
    const grib = bz.replace(/\.bz2$/, "");
    await bunzip2ToFile(bz, grib);
    tmp.push(grib);
    return grib;
  };

  try {
    for (const fhr of iconGlobalForecastSteps()) {
      for (const [variableId, fields] of Object.entries(ICON_GLOBAL_VAR_TOKENS)) {
        // DWD max-gust (vmax_10m) is a max-over-interval field: it has NO analysis
        // (f000) step. Rather than skip gust entirely under the default f0-only
        // config (→ no global gust base ever), source the fhr-0 slot from f001 —
        // the first real gust interval, a fine stand-in for "current" gust. Other
        // fields (instantaneous) use their own fhr.
        const srcStep = variableId === "gust" && fhr === 0 ? 1 : fhr;
        try {
          if (variableId === "wind") {
            const uPath = await fetchField(fields[0], srcStep);
            const vPath = await fetchField(fields[1], srcStep);
            // WIND: remap the PAIR (each earth-relative post-remap), bake directly.
            const u = await remapAndExtract({ inPath: uPath, match: ICON_GLOBAL_FIELD_MATCH[fields[0]], gridPath, weightsPath, width, height });
            const v = await remapAndExtract({ inPath: vPath, match: ICON_GLOBAL_FIELD_MATCH[fields[1]], gridPath, weightsPath, width, height });
            tmp.push(`${uPath}.rg.grib2`, `${vPath}.rg.grib2`);
            const r = await bakeVector({ variableId: "wind", u, v, width, height, preRolled: true });
            tag("wind", {
              encoding: "uv",
              units: "m/s",
              domain: r.domain,
              palette: "wind",
              imageUnscale: r.imageUnscale,
              vectorUnscale: r.imageUnscale,
              sourceId: source.id,
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
              priority: source.priority,
            }).buffers[fhr] = r.buffer;
          } else {
            const field = fields[0];
            const path = await fetchField(field, srcStep);
            const values = await remapAndExtract({ inPath: path, match: ICON_GLOBAL_FIELD_MATCH[field], gridPath, weightsPath, width, height });
            tmp.push(`${path}.rg.grib2`);
            // temp K→°C; gust already m/s, humidity already % (skip unit convert).
            const skipUnitConvert = variableId === "gust" || variableId === "humidity";
            const r = await bakeScalar({ variableId, values, width, height, preRolled: true, skipUnitConvert });
            const units = variableId === "temp" ? "°C" : variableId === "humidity" ? "%" : "m/s";
            tag(variableId, {
              encoding: "scalar",
              units,
              domain: r.domain,
              palette: variableId,
              imageUnscale: r.imageUnscale,
              sourceId: source.id,
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
              priority: source.priority,
            }).buffers[fhr] = r.buffer;
          }
        } catch (err) {
          log(TAG, "icon-global: bake failed", { fhr, variableId, err: String(err) });
        }
      }
    }

    if (Object.keys(variables).length === 0) {
      throw new Error("no icon-global variables baked (cdo/bunzip2 installed? DWD icosahedral endpoint/weights drift?)");
    }

    const bakedSteps = Array.from(
      new Set(Object.values(variables).flatMap((v) => Object.keys(v.buffers).map(Number))),
    ).sort((a, b) => a - b);
    const stepMeta = bakedSteps.map((fhr) => ({
      fhr,
      validTime: new Date(run.runDate.getTime() + fhr * 3600 * 1000).toISOString(),
    }));

    const { runId } = await publishSourceRun({
      model: source.id,
      runDate: run.runDate,
      bounds: [...source.bbox], // [-180,-90,179.75,90] — MUST equal the descriptor bbox
      grid: { width, height, res },
      steps: stepMeta,
      variables,
    });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

/**
 * BullMQ job handler for the ICON global nest. Kept here (self-contained) since
 * jobs/weather.ts + index.ts are owned elsewhere — wire it there when scheduling:
 *
 *   // jobs/weather.ts
 *   export async function refreshIconGlobal(_job: Job) { return ingestIconGlobal(); }
 *   // index.ts (repeatable job list)
 *   { event: "refreshIconGlobal", sourceId: "icon-global",
 *     every: Number(process.env.ICON_GLOBAL_INGEST_MS || 60 * 60 * 1000) },
 *
 * Default cadence: hourly (60·60·1000 ms) — the run publishes 4×/day, the extra
 * ticks are cheap no-ops (alreadyPublished skips).
 */
export async function refreshIconGlobal(): Promise<IngestResult> {
  return ingestIconGlobal();
}

/** Default ingest interval for the icon-global repeatable job (env-overridable). */
export const ICON_GLOBAL_INGEST_MS_DEFAULT = 60 * 60 * 1000;

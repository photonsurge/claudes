// weather/iconCommon.ts
// Shared ingest core for the DWD ICON nest family (ICON-D2 2.2 km central-Europe
// and ICON-EU 6.5 km all-Europe). Both nests publish the SAME shape — one
// bzip2-compressed regular-lat-lon GRIB2 per DWD field per step — and differ only
// in the URL builder and the descriptor grid. This module holds everything they
// share: bunzip2, the descriptor `-new_grid` spec, the wind-fixed per-component
// regrid, and the per-step/per-variable bake loop.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

import { getSource, type SourceDescriptor } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField, runWgrib2 } from "../grib/wgrib2";
import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { getAppDb } from "@photonsurge/shared/db/index";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";

const TAG = "job:weather:source";

export type IngestResult =
  | { published: true; model: string; run: string; runId: string; variables: string[] }
  | { skipped: true; model: string; run: string; reason: string };

/** [W,S,E,N] bounds equal within a small tolerance (float grid maths). */
function boundsMatch(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
}

/**
 * True if a complete published run already exists for this model+run time AND it
 * was baked on the CURRENT descriptor grid. If the stored bounds differ from the
 * descriptor bbox — i.e. the grid was corrected after this run baked (ICON-D2's
 * [-4,43,20,58] → [-3.94,43.18,20.34,58.08]) — we return false so the next ingest
 * re-bakes it onto the right grid instead of skipping. The manifest tiebreaks the
 * duplicate by generatedAt, so the fresh bake wins immediately.
 */
export async function alreadyPublished(model: string, runDate: Date): Promise<boolean> {
  const db = await getAppDb();
  const existing = await db.weatherRuns.getByQuery({ model, run: runDate, status: "complete", published: true });
  if (!(existing.success && existing.data)) return false;
  const want = getSource(model)?.bbox;
  const stored = (existing.data as { bounds?: number[] }).bounds;
  if (want && !boundsMatch(stored, want)) {
    log(TAG, "published run has stale bounds — re-baking onto corrected grid", { model, stored, want });
    return false;
  }
  return true;
}

/**
 * Decompress a `.bz2` file to `outPath` by shelling out to `bunzip2` (streamed,
 * keeps the original). Node has no built-in bzip2, so this is the minimal local
 * helper — `bunzip2` ships with every Linux base image the worker runs on.
 */
export function bunzip2ToFile(inPath: string, outPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(outPath);
    // `bunzip2 -c` decompresses to stdout without touching the input file.
    const child = spawn("bunzip2", ["-c", inPath]);
    let stderr = "";
    let exitCode: number | null = null;
    let flushed = false;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    // Resolve ONLY once the child exited 0 AND the output stream has fully flushed
    // to disk (its "finish" event). Resolving on the child's "close" alone — before
    // the pipe finished writing — hands wgrib2 a half-written file → sporadic
    // "read outside of file, bad grib file" truncation errors.
    const maybeDone = () => {
      if (settled || exitCode === null || !flushed) return;
      if (exitCode === 0) {
        settled = true;
        resolve(outPath);
      } else {
        fail(new Error(`bunzip2 exited ${exitCode}: ${stderr.trim()}`));
      }
    };
    child.on("error", fail);
    out.on("error", fail);
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.stdout.pipe(out);
    out.on("finish", () => { flushed = true; maybeDone(); });
    child.on("close", (code) => { exitCode = code ?? 0; maybeDone(); });
  });
}

/**
 * The descriptor's regular grid as a wgrib2 `-new_grid` spec so the resampled
 * field lands EXACTLY on the dims/bbox the client resolver expects for this
 * nest: `latlon lon0:nx:dlon lat0:ny:dlat`.
 */
export function descriptorNewGrid(sourceId: string): { newgrid: string; width: number; height: number; res: number } {
  const source = getSource(sourceId)!;
  const width = source.dims!.width;
  const height = source.dims!.height;
  const res = source.resolutionDeg;
  const [w, s] = source.bbox;
  const newgrid = `latlon ${w}:${width}:${res} ${s}:${height}:${res}`;
  return { newgrid, width, height, res };
}

/**
 * Resample ONE ICON GRIB2 field onto the descriptor grid (already −180..180 /
 * regular, so the bake runs with `preRolled: true`) and return the Float32 grid.
 * Runs `wgrib2 IN -match RE -new_grid ...`.
 *
 * WIND-FIX: pass `-new_grid_vectors none`. `-new_grid` treats U/V as a VECTOR
 * PAIR and — critically — wgrib2 DEFAULTS `-new_grid_winds` to `earth` even when
 * we don't set it (it prints "Warning: -new_grid_winds set to earth"). Given a
 * LONE u (or v) component it then refuses to interpolate ("last field UGRD was
 * not interpolated (missing V)") and writes ZERO bytes → extractField throws
 * "short output for match=*" and wind never bakes (scalars were unaffected —
 * exactly the symptom seen). `-new_grid_vectors none` makes wgrib2 interpolate
 * EVERY field as an independent scalar, no U/V pairing. DWD's `regular-lat-lon`
 * ICON winds are ALREADY earth-relative, so per-component interpolation is
 * correct (no rotation needed). Verified on a live DWD u_10m file: 0 bytes with
 * the pairing default, full 1215×746 grid with `-new_grid_vectors none`. Harmless
 * for scalars (temp/gust/humidity have no vector partner to disable).
 */
export async function extractOnDescriptorGrid(
  gribPath: string,
  match: string,
  newgrid: string,
  width: number,
  height: number,
): Promise<Float32Array> {
  const outPath = `${gribPath}.rg.grib2`;
  await runWgrib2([
    gribPath,
    "-new_grid_vectors", "none",
    "-match", match,
    "-new_grid", ...newgrid.split(" "),
    outPath,
  ]);
  const field = await extractField({ gribPath: outPath, width, height });
  return field.values;
}

/**
 * Shared per-run bake loop for an ICON nest. Downloads + bunzip2 + regrids +
 * bakes every variable across every step, then publishes the run. The two ICON
 * ingesters (D2, EU) provide only their per-source knobs via `IconIngestConfig`.
 */
export interface IconIngestConfig {
  /** Source/descriptor id, e.g. "icon-d2" / "icon-eu". */
  sourceId: string;
  /** our variable id → DWD field token(s) (wind → [u,v]; scalars → [field]). */
  varTokens: Record<string, string[]>;
  /** wgrib2 -match token per DWD field. */
  fieldMatch: Record<string, string>;
  /** Build the DWD URL for one (run, step, field). */
  buildUrl: (args: { date: string; cycle: string; step: number; field: string }) => string;
  /** Resolve the latest available run (probe-backed). */
  latestRun: (now: Date, fetchHead: typeof headOk) => Promise<{ date: string; cycle: string; runDate: Date }>;
  /** Forecast steps (hours) to bake. */
  steps: number[];
  /** Zero-pad a step to the DWD 3-digit fff token. */
  padStep: (step: number) => string;
}

export async function ingestIconNest(cfg: IconIngestConfig, now = new Date()): Promise<IngestResult> {
  const source: SourceDescriptor = getSource(cfg.sourceId)!;
  const run = await cfg.latestRun(now, headOk);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const { newgrid, width, height, res } = descriptorNewGrid(cfg.sourceId);
  const variables: Record<string, BakedVariable> = {};
  const tag = (id: string, meta: BakedVariable["meta"]) => (variables[id] ??= { meta, buffers: {} });
  const tmp: string[] = [];
  // Per-invocation token so two concurrent ingests of the SAME nest (a repeatable
  // firing while a boot-kick / reset re-kick of the same source is still running)
  // never share a temp path. Without it both wrote `icon-d2.relhum_2m.f001.grib2`,
  // one truncating the other mid-read → wgrib2 "read outside of file, bad grib file".
  const runTag = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

  /** Download + bunzip2 one DWD field for a step; returns the plain GRIB2 path. */
  const fetchField = async (field: string, step: number): Promise<string> => {
    await nomadsGate();
    const bz = await downloadToTemp(
      cfg.buildUrl({ date: run.date, cycle: run.cycle, step, field }),
      `${cfg.sourceId}.${runTag}.${field}.f${cfg.padStep(step)}.grib2.bz2`,
    );
    tmp.push(bz);
    const grib = bz.replace(/\.bz2$/, "");
    await bunzip2ToFile(bz, grib);
    tmp.push(grib);
    return grib;
  };

  try {
    for (const fhr of cfg.steps) {
      for (const [variableId, fields] of Object.entries(cfg.varTokens)) {
        try {
          if (variableId === "wind") {
            const uPath = await fetchField(fields[0], fhr);
            const vPath = await fetchField(fields[1], fhr);
            const u = await extractOnDescriptorGrid(uPath, cfg.fieldMatch[fields[0]], newgrid, width, height);
            const v = await extractOnDescriptorGrid(vPath, cfg.fieldMatch[fields[1]], newgrid, width, height);
            tmp.push(`${uPath}.rg.grib2`, `${vPath}.rg.grib2`);
            const res2 = await bakeVector({ variableId: "wind", u, v, width, height, preRolled: true });
            tag("wind", {
              encoding: "uv",
              units: "m/s",
              domain: res2.domain,
              palette: "wind",
              imageUnscale: res2.imageUnscale,
              vectorUnscale: res2.imageUnscale,
              sourceId: source.id,
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
              priority: source.priority,
            }).buffers[fhr] = res2.buffer;
          } else {
            const field = fields[0];
            const path = await fetchField(field, fhr);
            const values = await extractOnDescriptorGrid(path, cfg.fieldMatch[field], newgrid, width, height);
            tmp.push(`${path}.rg.grib2`);
            // temp K→°C; gust already m/s, humidity already % (skip unit convert).
            const skipUnitConvert = variableId === "gust" || variableId === "humidity";
            const res2 = await bakeScalar({ variableId, values, width, height, preRolled: true, skipUnitConvert });
            const units = variableId === "temp" ? "°C" : variableId === "humidity" ? "%" : "m/s";
            tag(variableId, {
              encoding: "scalar",
              units,
              domain: res2.domain,
              palette: variableId,
              imageUnscale: res2.imageUnscale,
              sourceId: source.id,
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
              priority: source.priority,
            }).buffers[fhr] = res2.buffer;
          }
        } catch (err) {
          log(TAG, `${cfg.sourceId}: bake failed`, { fhr, variableId, err: String(err) });
        }
      }
    }

    if (Object.keys(variables).length === 0) {
      throw new Error(`no ${cfg.sourceId} variables baked (bunzip2 installed? DWD endpoint/token drift?)`);
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
      bounds: [...source.bbox],
      grid: { width, height, res },
      steps: stepMeta,
      variables,
    });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

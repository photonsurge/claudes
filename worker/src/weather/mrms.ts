// weather/mrms.ts
// MRMS radar (CONUS) ingest core — mirrors ingestRtofs / ingestWaveMosaic:
//   1. resolve the newest ~2-min reflectivity file (listing, poll fallback),
//   2. SKIP if that model+valid-time is already published (idempotent),
//   3. download .gz → gunzip → wgrib2 regrid/subset to the 0.02° descriptor grid,
//   4. bake reflectivity to a scalar PNG with a clear-air/no-coverage transparency
//      mask, and publish via publishSourceRun under model "mrms".
//
// Worker-only: web reads DB textures. Kept free of process.exit/loadEnv so the
// scheduled job and the manual `refresh:mrms` script share this exact core.

import { gunzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";

import { getAppDb } from "@photonsurge/shared/db/index";
import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { extractField, runWgrib2 } from "../grib/wgrib2";
import { imageUnscaleFor } from "../grib/bake";
import { encodeScalarPng } from "../grib/encode";
import { downloadToTemp, cleanupTemp, headOk } from "./download";
import { nomadsGate } from "./politeness";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import {
  mrmsLatestAvailable,
  mrmsLatestByPoll,
  MRMS_MATCH,
  MRMS_NEWGRID,
  MRMS_TARGET_GRID,
  MRMS_TARGET_BOUNDS,
  MRMS_NO_COVERAGE,
  MRMS_NO_ECHO,
  MRMS_MIN_VISIBLE_DBZ,
} from "../sources/mrms";
import type { IngestResult } from "./multiSource";

const TAG = "job:weather:source";
const VARIABLE_ID = "radar";

/** Default directory-listing fetch (returns raw HTML). */
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listing failed ${res.status} for ${url}`);
  return res.text();
}

/** True if a complete published run already exists for this model+valid time. */
async function alreadyPublished(model: string, runDate: Date): Promise<boolean> {
  const db = await getAppDb();
  const existing = await db.weatherRuns.getByQuery({ model, run: runDate, status: "complete", published: true });
  return !!(existing.success && existing.data);
}

/**
 * Build the reflectivity keep mask: transparent where MRMS reports no coverage /
 * no echo, at GRIB-undefined points, or below the clear-air floor (~5 dBZ) so the
 * base map shows through where it isn't raining. `radar` has no `minVisible` in
 * the shared registry (NEST-ONLY), so we enforce the floor here rather than via
 * scalarKeepMask — which keeps this the ONLY place radar transparency is decided.
 */
export function radarKeepMask(values: Float32Array): Uint8Array {
  const keep = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const ok =
      Number.isFinite(v) &&
      Math.abs(v) < 1e20 &&            // wgrib2 UNDEFINED
      v > MRMS_NO_COVERAGE + 1 &&      // -999 no coverage
      v > MRMS_NO_ECHO + 1 &&          // -99 no echo / range-folded
      v >= MRMS_MIN_VISIBLE_DBZ;       // clear-air floor
    keep[i] = ok ? 1 : 0;
  }
  return keep;
}

export async function ingestMrms(now = new Date()): Promise<IngestResult> {
  const source = getSource("mrms")!;
  const W = MRMS_TARGET_GRID.width;
  const H = MRMS_TARGET_GRID.height;

  // 1. Resolve the newest file: directory listing first, HEAD-poll fallback.
  let latest = await mrmsLatestAvailable(fetchText);
  if (!latest) latest = await mrmsLatestByPoll(now, headOk);
  if (!latest) {
    return { skipped: true, model: source.id, run: now.toISOString(), reason: "no MRMS file available" };
  }
  const runDate = latest.validTime;

  // 2. Idempotent skip.
  if (await alreadyPublished(source.id, runDate)) {
    return { skipped: true, model: source.id, run: runDate.toISOString(), reason: "already published" };
  }

  const tmp: string[] = [];
  try {
    // 3. Download the gzip'd GRIB2, gunzip to a plain .grib2.
    await nomadsGate();
    const gzPath = await downloadToTemp(latest.url, "mrms.grib2.gz");
    tmp.push(gzPath);
    const gribPath = `${gzPath.replace(/\.gz$/, "")}`;
    await writeFile(gribPath, gunzipSync(await readFile(gzPath)));
    tmp.push(gribPath);

    // Regrid/subset the native 0.01° mosaic onto the 0.02° descriptor grid.
    const regridPath = `${gribPath}.rg.grib2`;
    await runWgrib2([
      gribPath,
      "-match", MRMS_MATCH,
      "-new_grid_winds", "earth",
      "-new_grid", ...MRMS_NEWGRID.split(" "),
      regridPath,
    ]);
    tmp.push(regridPath);

    const field = await extractField({ gribPath: regridPath, width: W, height: H });

    // 4. Bake — reflectivity is already in dBZ (no unit convert), already at
    //    -180..180 (preRolled). We build the keep mask + PNG directly because
    //    bakeScalar's mask path has no radar config.
    const imageUnscale = imageUnscaleFor(VARIABLE_ID); // radar decode range (dBZ)
    const keep = radarKeepMask(field.values);
    const buffer = await encodeScalarPng(field.values, W, H, imageUnscale, keep);

    const validTime = runDate.toISOString();
    const variables: Record<string, BakedVariable> = {
      radar: {
        meta: {
          encoding: "scalar",
          units: "dBZ",
          domain: [5, 75],
          palette: "radar",
          imageUnscale,
          sourceId: source.id,
          resolutionDeg: source.resolutionDeg,
          bbox: [...source.bbox],
          priority: source.priority,
        },
        buffers: { 0: buffer },
      },
    };

    const { runId } = await publishSourceRun({
      model: source.id,
      runDate,
      bounds: [...MRMS_TARGET_BOUNDS],
      grid: { width: W, height: H, res: MRMS_TARGET_GRID.res },
      steps: [{ fhr: 0, validTime }],
      variables,
    });
    return { published: true, model: source.id, run: validTime, runId, variables: ["radar"] };
  } catch (err) {
    log(TAG, "mrms: ingest failed", { err: String(err) });
    throw err;
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

/** Diagnostics aid: print the wgrib2 inventory of an MRMS GRIB2 (token check). */
export async function mrmsInventory(gribPath: string): Promise<string[]> {
  const inv = (await runWgrib2([gribPath])).toString();
  return inv.split("\n").filter(Boolean);
}

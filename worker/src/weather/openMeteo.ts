// weather/openMeteo.ts
// Ingest core for the Open-Meteo spatial-grid NESTS (JMA first; AU/CN/KR are a
// one-line OM_MODELS add). A NEW bake path: NO GRIB/wgrib2/cdo. Per enabled model
//   1. resolve the latest completed run from data_spatial/<model>/latest.json,
//   2. SKIP if that model+run is already published (idempotent),
//   3. download the f0 spatial `.om` (all variables for one timestamp),
//   4. read each variable's 2-D Float32 grid with the OM-Files reader
//      (@openmeteo/file-reader → OmFileReader.getChildByName + read),
//   5. flip rows S→N→ north-up (the `.om` grid is lat SOUTH-first), then
//      bakeScalar (temp/humidity — already DISPLAY units → skipUnitConvert) +
//      bakeVector (wind u/v — earth-relative m/s → bake directly),
//   6. publishSourceRun tagged with the descriptor's source meta.
//
// Worker-only: downloads `.om`, bakes textures, stores them in Mongo. Idempotent,
// nomadsGate-throttled, temp cleaned up in `finally`, per-variable failures
// skipped (one missing/rotten var never blocks the rest). Kept free of
// process.exit/loadEnv so callers own the runtime. Handler suggestion:
// `refreshOpenMeteo`.

import { getSource } from "@photonsurge/shared/sources";
import { log } from "@photonsurge/shared/utill/logger";

import { bakeScalar } from "../grib/bakeScalar";
import { bakeVector } from "../grib/bakeVector";
import { downloadToTemp, cleanupTemp } from "./download";
import { nomadsGate } from "./politeness";
import { getAppDb } from "@photonsurge/shared/db/index";
import { publishSourceRun, type BakedVariable } from "./publishSourceRun";
import { type IngestResult } from "./multiSource";
import {
  omModels,
  omLatestRun,
  buildOmUrl,
  type OmModel,
  type OmRun,
  type FetchJson,
} from "../sources/openMeteo";

const TAG = "job:weather:source";

/** True if a complete published run already exists for this model+run time. */
async function alreadyPublished(model: string, runDate: Date): Promise<boolean> {
  const db = await getAppDb();
  const existing = await db.weatherRuns.getByQuery({ model, run: runDate, status: "complete", published: true });
  return !!(existing.success && existing.data);
}

/** Plain-fetch JSON (latest.json). Injected into omLatestRun so the resolver stays pure. */
const fetchJson: FetchJson = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo: ${res.status} for ${url}`);
  return res.json();
};

/**
 * Flip a row-major width×height grid vertically (row 0 ↔ last row). The Open-Meteo
 * `.om` grid is lat SOUTH-first (row 0 = south); the bake/encoder convention is
 * "row 0 = NORTH", so we flip before baking. Columns (lon, west→east) are already
 * in bake order.
 */
export function flipRows(values: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let row = 0; row < height; row++) {
    const src = row * width;
    const dst = (height - 1 - row) * width;
    out.set(values.subarray(src, src + width), dst);
  }
  return out;
}

/**
 * Read one named variable's 2-D grid from an already-open OM-Files reader as a
 * north-up Float32Array (width·height). Returns undefined when the child is
 * absent (e.g. jma_msm has no wind_gusts_10m) so the caller skips it cleanly.
 * `readOm` is injected so the ingest is testable without WASM (the live path
 * passes the real @openmeteo/file-reader wrapper).
 */
export type OmChildReader = (name: string) => Promise<Float32Array | undefined>;

/** Read + flip one scalar → north-up grid, or undefined if the child is missing. */
async function readGrid(
  readOm: OmChildReader,
  name: string,
  width: number,
  height: number,
): Promise<Float32Array | undefined> {
  const raw = await readOm(name);
  if (!raw) return undefined;
  if (raw.length !== width * height) {
    throw new Error(`open-meteo: ${name} length ${raw.length} != ${width}×${height}`);
  }
  return flipRows(raw, width, height);
}

/**
 * Open a downloaded `.om` file and return a name→Float32Array reader. Lazily
 * imports @openmeteo/file-reader (WASM/ESM) so the pure sources module and the
 * unit tests never touch it. Returns the reader plus a dispose fn.
 */
async function openOmFile(path: string): Promise<{ read: OmChildReader; dispose: () => void }> {
  // Lazy ESM import of the OM-Files reader (WASM-backed). See sources/openMeteo.ts
  // for the confirmed API: OmFileReader.create(FileBackend) → getChildByName →
  // getDimensions → read({ type: OmDataType.FloatArray, ranges }).
  const mod = await import("@openmeteo/file-reader");
  const { OmFileReader, FileBackend, OmDataType } = mod as unknown as {
    OmFileReader: { create(backend: unknown): Promise<any> };
    FileBackend: new (source: string) => unknown;
    OmDataType: { FloatArray: number };
  };
  const backend = new FileBackend(path);
  const root = await OmFileReader.create(backend);
  const read: OmChildReader = async (name: string) => {
    const child = await root.getChildByName(name);
    if (!child) return undefined;
    const dims: number[] = child.getDimensions(); // [ny(lat), nx(lon)] row-major
    const ranges = dims.map((d: number) => ({ start: 0, end: d }));
    const data: Float32Array = await child.read({ type: OmDataType.FloatArray, ranges });
    return data;
  };
  const dispose = () => {
    try { (root as { dispose?: () => void }).dispose?.(); } catch { /* ignore */ }
  };
  return { read, dispose };
}

/** Ingest ONE Open-Meteo model for its latest completed run. */
async function ingestOneModel(model: OmModel): Promise<IngestResult> {
  const source = getSource(model.sourceId)!;
  const run: OmRun = await omLatestRun(model.omModel, fetchJson);
  if (await alreadyPublished(source.id, run.runDate)) {
    return { skipped: true, model: source.id, run: run.runDate.toISOString(), reason: "already published" };
  }

  const W = model.dims.width;
  const H = model.dims.height;
  const variables: Record<string, BakedVariable> = {};
  const tmp: string[] = [];
  try {
    await nomadsGate();
    const omPath = await downloadToTemp(
      buildOmUrl(model.omModel, run.runDate, run.validDate),
      `${model.omModel}.f0.om`,
    );
    tmp.push(omPath);

    const { read: readOm, dispose } = await openOmFile(omPath);
    try {
      // Scalars (temp/humidity): Open-Meteo decodes to DISPLAY units already
      // (temp °C, RH %), so skipUnitConvert. preRolled: the grid is a regular
      // absolute-lon subset (120..150), no 0..360 roll needed.
      for (const [variableId, omName] of Object.entries(model.varMap.scalars)) {
        if (!source.variables.includes(variableId)) continue;
        try {
          const grid = await readGrid(readOm, omName, W, H);
          if (!grid) { log(TAG, "open-meteo: scalar absent, skipped", { model: source.id, variableId, omName }); continue; }
          const res = await bakeScalar({
            variableId, values: grid, width: W, height: H, preRolled: true, skipUnitConvert: true,
          });
          variables[variableId] = {
            meta: {
              encoding: "scalar",
              units: variableId === "temp" ? "°C" : "%",
              domain: res.domain,
              palette: variableId,
              imageUnscale: res.imageUnscale,
              sourceId: source.id,
              resolutionDeg: source.resolutionDeg,
              bbox: source.bbox,
              priority: source.priority,
            },
            buffers: { 0: res.buffer },
          };
        } catch (err) {
          log(TAG, "open-meteo: scalar bake failed", { model: source.id, variableId, err: String(err) });
        }
      }

      // Wind: u/v are EARTH-RELATIVE m/s → bake the pair directly (no rotation).
      if (model.varMap.windUV && source.variables.includes("wind")) {
        try {
          const u = await readGrid(readOm, model.varMap.windUV.u, W, H);
          const v = await readGrid(readOm, model.varMap.windUV.v, W, H);
          if (u && v) {
            const res = await bakeVector({ variableId: "wind", u, v, width: W, height: H, preRolled: true });
            variables.wind = {
              meta: {
                encoding: "uv", units: "m/s", domain: res.domain, palette: "wind",
                imageUnscale: res.imageUnscale, vectorUnscale: res.imageUnscale,
                sourceId: source.id, resolutionDeg: source.resolutionDeg, bbox: source.bbox, priority: source.priority,
              },
              buffers: { 0: res.buffer },
            };
          } else {
            log(TAG, "open-meteo: wind u/v absent, skipped", { model: source.id });
          }
        } catch (err) {
          log(TAG, "open-meteo: wind bake failed", { model: source.id, err: String(err) });
        }
      }
    } finally {
      dispose();
    }

    if (Object.keys(variables).length === 0) {
      throw new Error(`no Open-Meteo variables baked for ${source.id} (om child names / grid dims drift?)`);
    }

    const validTime = run.validDate.toISOString();
    const { runId } = await publishSourceRun({
      model: source.id,
      runDate: run.runDate,
      bounds: [...source.bbox],
      grid: { width: W, height: H, res: source.resolutionDeg },
      steps: [{ fhr: 0, validTime }],
      variables,
    });
    return { published: true, model: source.id, run: run.runDate.toISOString(), runId, variables: Object.keys(variables) };
  } finally {
    for (const p of tmp) await cleanupTemp(p);
  }
}

/**
 * Ingest every ENABLED Open-Meteo spatial-grid nest for its latest run. Loops the
 * OM_MODELS family (like waveNests/rtofsRegional loop theirs) — one model's
 * failure never blocks the others. f0 (analysis) only to start.
 */
export async function ingestOpenMeteo(now = new Date()): Promise<IngestResult[]> {
  void now; // each model resolves its own latest run from latest.json.
  const results: IngestResult[] = [];
  for (const model of omModels()) {
    const source = getSource(model.sourceId);
    if (!source?.enabled) continue;
    try {
      results.push(await ingestOneModel(model));
    } catch (err) {
      log(TAG, "open-meteo: ingest failed", { model: model.sourceId, err: String(err) });
      results.push({ skipped: true, model: model.sourceId, run: now.toISOString(), reason: String(err) });
    }
  }
  return results;
}

// netcdf/reader.ts
// Reader for RTOFS 2-D surface netCDF (tripolar). Uses `netcdfjs` (pure JS) for
// the CLASSIC NetCDF-3 data model. RTOFS files on NOMADS are NetCDF-4/HDF5, which
// netcdfjs can't parse ("should start with CDF"), so we first detect the magic and
// convert NetCDF-4 → classic with `nccopy -k classic` (the standard netCDF CLI,
// normally installed alongside wgrib2). Install netcdfjs before running RTOFS:
//   cd worker && yarn install
//
// ⚠️ INTEGRATION SEAM — confirm variable/coord/dim names via `ncdump -h`.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { open, readFile } from "node:fs/promises";
import type { CurvilinearField } from "../regrid/curvilinear";

const pexec = promisify(execFile);

/* eslint-disable @typescript-eslint/no-explicit-any */

interface NcReader {
  header: any;
  variables: Array<{ name: string; dimensions: any[] }>;
  getDataVariable(name: string): ArrayLike<number>;
}

async function magic4(path: string): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * Return a path to a CLASSIC NetCDF-3 file for `path`. If `path` is already
 * classic ("CDF" magic) it's returned as-is; if it's NetCDF-4/HDF5 ("\x89HDF")
 * it's converted with `nccopy -k classic` to `<path>.classic.nc`. Throws with a
 * clear hint if nccopy is missing or the magic is unrecognised.
 */
export async function ensureClassicNetcdf(path: string): Promise<string> {
  const m = await magic4(path);
  if (m[0] === 0x43 && m[1] === 0x44 && m[2] === 0x46) return path; // "CDF" → classic
  const isHdf5 = m[0] === 0x89 && m[1] === 0x48 && m[2] === 0x44 && m[3] === 0x46; // \x89HDF
  if (!isHdf5) {
    throw new Error(`unrecognised netCDF magic ${m.toString("hex")} for ${path} (not CDF/HDF5)`);
  }
  const out = `${path}.classic.nc`;
  try {
    await pexec("nccopy", ["-k", "classic", path, out]);
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error("RTOFS file is NetCDF-4/HDF5 and `nccopy` is not installed — install the netCDF CLI tools (nccopy/ncdump), or convert the file to NetCDF-3 classic before ingest");
    }
    throw err;
  }
  return out;
}

async function open_(path: string): Promise<NcReader> {
  const classic = await ensureClassicNetcdf(path);
  const buffer = await readFile(classic);
  const modName = "netcdfjs";
  const mod: any = await import(modName).catch(() => {
    throw new Error("netcdfjs not installed — run `yarn install` in worker/ before RTOFS ingest");
  });
  const NetCDFReader = mod.NetCDFReader ?? mod.default?.NetCDFReader ?? mod.default;
  return new NetCDFReader(buffer);
}

function toF32(a: ArrayLike<number>): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}

/** Read one variable's full flat array as Float32. */
export async function readVariable(path: string, name: string): Promise<Float32Array> {
  const nc = await open_(path);
  return toF32(nc.getDataVariable(name));
}

/**
 * Read a curvilinear field (values + 2-D lon/lat coord arrays) for one time
 * index. RTOFS prog vars are dimensioned (MT, Y, X); we slice the time step out
 * and pair with the (Y,X) Latitude/Longitude coord arrays for the regrid.
 */
export async function readCurvilinearField(
  path: string,
  opts: { variable: string; latVar: string; lonVar: string; timeIndex?: number },
): Promise<CurvilinearField> {
  const nc = await open_(path);
  const lat = toF32(nc.getDataVariable(opts.latVar));
  const lon = toF32(nc.getDataVariable(opts.lonVar));
  const flat = toF32(nc.getDataVariable(opts.variable));
  const cells = lat.length; // Y*X
  const t = opts.timeIndex ?? 0;
  const values = flat.length > cells ? flat.subarray(t * cells, (t + 1) * cells) : flat;
  return { values: Float32Array.from(values), lat, lon };
}

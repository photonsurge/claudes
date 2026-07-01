// netcdf/toGrib2.ts
// Convert an RTOFS 2-D surface netCDF to GRIB2 with `cdo`, so the file drops into
// the existing wgrib2 → bake path (no netcdfjs, no nccopy, no JS regrid). cdo reads
// NetCDF-4/HDF5 natively, so the classic-downgrade dance is moot.
//
//   cdo -f grb2 [-selname,VARS] copy in.nc out.grb2
//
// The interpolated global 2ds product is rectilinear (regular lat/lon), so plain
// `copy` suffices. If a file turns out to be on the native tripolar grid, add a
// remap step (`-remapbil,<grid>`) — cdo reads the 2-D coord arrays. Needs `cdo`
// on PATH (standard met tool alongside wgrib2); errors clearly if absent.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export type CdoRunner = (bin: string, args: string[]) => Promise<void>;

const defaultRunner: CdoRunner = async (bin, args) => {
  await pexec(bin, args, { maxBuffer: 16 * 1024 * 1024 });
};

export interface CdoConvertArgs {
  inPath: string;
  outPath: string;
  /** netCDF variable names to keep (cdo -selname). Omit to copy all. */
  selnames?: string[];
  /** wgrib2/cdo grid spec for -remapbil (native tripolar only). */
  remapGrid?: string;
  cdoBin?: string;
  runner?: CdoRunner;
}

/**
 * Build the cdo argument vector (pure, unit-testable).
 *
 * cdo chains operators right-to-left: the rightmost reads the file, and only the
 * INNER (piped) operators take a leading `-`; the outermost takes none. Crucially
 * `remapbil`/`selname` are themselves file-reading operators, so `copy` is used
 * ONLY when neither is present (appending `copy` alongside remapbil is the
 * "No Operators with missing input left" abort). Forms produced:
 *   plain           : cdo -f grb2 copy IN OUT
 *   remap           : cdo -f grb2 remapbil,GRID IN OUT
 *   remap + selname : cdo -f grb2 remapbil,GRID -selname,VARS IN OUT
 *   selname         : cdo -f grb2 selname,VARS IN OUT
 */
export function buildCdoArgs(args: Omit<CdoConvertArgs, "runner" | "cdoBin">): string[] {
  const chain: string[] = [];
  if (args.remapGrid) chain.push(`remapbil,${args.remapGrid}`);
  if (args.selnames?.length) chain.push(`selname,${args.selnames.join(",")}`);
  if (chain.length === 0) chain.push("copy");
  // Outermost operator: no dash; each subsequent piped operator: leading dash.
  const ops = chain.map((op, i) => (i === 0 ? op : `-${op}`));
  return ["-f", "grb2", ...ops, args.inPath, args.outPath];
}

/** Run cdo to convert netCDF → GRIB2. Returns the outPath. */
export async function netcdfToGrib2(args: CdoConvertArgs): Promise<string> {
  const bin = args.cdoBin ?? "cdo";
  const runner = args.runner ?? defaultRunner;
  try {
    await runner(bin, buildCdoArgs(args));
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw new Error("`cdo` not installed — install the CDO climate tools (they read NetCDF-4 and emit GRIB2) before RTOFS ingest");
    }
    throw err;
  }
  return args.outPath;
}

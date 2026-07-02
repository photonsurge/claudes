// grib/wgrib2.ts
// Thin wrapper around the `wgrib2` CLI to dump a raw Float32 grid from a GRIB2
// file. The actual child_process call is isolated behind `runWgrib2` so tests
// can mock it.

import { execFile } from "node:child_process";

export interface Wgrib2Grid {
  width: number;
  height: number;
  /** Row-major, we:ns order (column 0 = first longitude, row 0 = north). */
  values: Float32Array;
}

export interface ExtractFieldArgs {
  /** Path to the downloaded GRIB2 file. */
  gribPath: string;
  /**
   * wgrib2 `-match` regex selecting the single record to dump, e.g.
   * ":UGRD:10 m above ground:". When omitted, the first/only record is dumped.
   */
  match?: string;
  /** GFS 0.25° defaults. */
  width?: number;
  height?: number;
  /** Injectable runner (defaults to runWgrib2) so tests can mock the CLI. */
  runner?: (args: string[]) => Promise<Buffer>;
}

/** Low-level, mockable child_process call. Resolves with raw stdout bytes. */
export function runWgrib2(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      "wgrib2",
      args,
      { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout as Buffer);
      },
    );
  });
}

/**
 * Parse a raw little-endian Float32 binary blob (as produced by
 * `wgrib2 -no_header -bin`) into a Float32Array of width*height.
 */
export function parseRawFloat32(buf: Buffer, width: number, height: number): Float32Array {
  const expected = width * height;
  // Use a copy to ensure correct alignment / standalone buffer.
  const out = new Float32Array(expected);
  for (let i = 0; i < expected; i++) {
    out[i] = buf.readFloatLE(i * 4);
  }
  return out;
}

/**
 * Extract one field from a GRIB file as a raw Float32 grid using:
 *   wgrib2 <file> [-match RE] -order we:ns -no_header -bin -
 * Output is dumped to stdout and parsed into a Float32Array (the FIRST record when
 * the match selects several — see the multiple-of guard below).
 */
export async function extractField({
  gribPath,
  match,
  width = 1440,
  height = 721,
  runner = runWgrib2,
}: ExtractFieldArgs): Promise<Wgrib2Grid> {
  const args: string[] = [gribPath];
  if (match) args.push("-match", match);
  // `-inv /dev/null` is REQUIRED: without it wgrib2 writes the inventory text to
  // stdout, mixed into the -bin output, shifting/corrupting every value.
  args.push("-order", "we:ns", "-no_header", "-inv", "/dev/null", "-bin", "-");

  const stdout = await runner(args);
  // Guard empty/short output (e.g. APCP has no record at f000) so the caller can
  // skip this field instead of decoding garbage.
  const expectedBytes = width * height * 4;
  if (stdout.length < expectedBytes) {
    throw new Error(
      `wgrib2: short output (${stdout.length} < ${expectedBytes} bytes) for match=${match ?? "*"}`,
    );
  }
  // A match may select SEVERAL records on the same grid (e.g. RTOFS regional files
  // bundle 24 hourly steps, so ":WTMP:" returns 24 records). Then stdout is a whole
  // multiple of nx*ny*4 and we keep the first record. If it is NOT a whole multiple,
  // the caller's (width,height) does not match the record's true grid — reshaping
  // would shear every row (horizontal striping). Fail loudly instead of decoding
  // garbage; the ingest path must pass the grid's real nx/ny (see probeGridGeometry).
  if (stdout.length % expectedBytes !== 0) {
    throw new Error(
      `wgrib2: output ${stdout.length}B is not a whole multiple of nx*ny*4=${expectedBytes} ` +
        `for match=${match ?? "*"} — grid dims (${width}x${height}) do not match the record`,
    );
  }
  const values = parseRawFloat32(stdout, width, height);
  return { width, height, values };
}

/** Grid geometry as reported by `wgrib2 -grid` for a single lat-lon record. */
export interface GribGridGeometry {
  nx: number;
  ny: number;
  /** First/last lat as printed by wgrib2 (scan order; may be S→N or N→S). */
  lat0: number;
  lat1: number;
  /** First/last lon as printed (ascending; native frame, often 0..360). */
  lon0: number;
  lon1: number;
  dLat: number;
  dLon: number;
}

const GRID_DIMS_RE = /lat-lon grid:\((\d+)\s*x\s*(\d+)\)/;
const GRID_LAT_RE = /lat\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)\s+by\s+(-?[\d.]+)/;
const GRID_LON_RE = /lon\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)\s+by\s+(-?[\d.]+)/;

/**
 * Parse the grid block emitted by `wgrib2 -grid` (the indented
 * `lat-lon grid:(NX x NY) … lat A to B by D … lon A to B by D` lines) into typed
 * geometry. Throws on any non-`lat-lon` / unparseable block. Pure.
 */
export function parseGridGeometry(gridText: string): GribGridGeometry {
  const dims = GRID_DIMS_RE.exec(gridText);
  const la = GRID_LAT_RE.exec(gridText);
  const lo = GRID_LON_RE.exec(gridText);
  if (!dims || !la || !lo) {
    throw new Error(`wgrib2 -grid: unparseable lat-lon grid def:\n${gridText}`);
  }
  return {
    nx: Number(dims[1]),
    ny: Number(dims[2]),
    lat0: Number(la[1]),
    lat1: Number(la[2]),
    dLat: Number(la[3]),
    lon0: Number(lo[1]),
    lon1: Number(lo[2]),
    dLon: Number(lo[3]),
  };
}

export interface ProbeGeometryArgs {
  gribPath: string;
  /** Select one representative record; its grid def is read (all steps share it). */
  match?: string;
  runner?: (args: string[]) => Promise<Buffer>;
}

/**
 * Read the TRUE grid geometry of a GRIB2 record via `wgrib2 -grid`. The regional
 * RTOFS descriptors only carry coarse bbox/dims GUESSES; the reshape and the
 * published bounds must come from the file itself or every row shears. Parses the
 * first grid block (a multi-record match prints one identical block per record).
 */
export async function probeGridGeometry({
  gribPath,
  match,
  runner = runWgrib2,
}: ProbeGeometryArgs): Promise<GribGridGeometry> {
  const args: string[] = [gribPath];
  if (match) args.push("-match", match);
  args.push("-grid");
  const stdout = await runner(args);
  return parseGridGeometry(stdout.toString("utf8"));
}

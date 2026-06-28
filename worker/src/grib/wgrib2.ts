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
 * Output is dumped to stdout and parsed into a Float32Array.
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
  args.push("-order", "we:ns", "-no_header", "-bin", "-");

  const stdout = await runner(args);
  const values = parseRawFloat32(stdout, width, height);
  return { width, height, values };
}

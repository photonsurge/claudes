// merge/mosaic.ts
// Server-side merge resolver (spec §6.3 Option B): composite several regional
// tiles of ONE variable into a single global texture. Each tile is first
// regridded to a common global lat-lon grid (wgrib2 -new_grid), leaving nodata
// outside its footprint; `mosaicByPriority` then picks, per pixel, the value from
// the highest-priority tile that covers it. The composited Float32 grid feeds the
// existing scalar bake (nodata → transparent), so the client sees one texture and
// needs no change. Reused later for HRRR/ICON nests over the global base.

import { extractField, type Wgrib2Grid } from "../grib/wgrib2";
import { runWgrib2 } from "../grib/wgrib2";

/** wgrib2 -bin writes UNDEFINED (outside a tile's footprint) as ~9.999e20. */
export const GRIB_UNDEFINED = 1e20;
const UNDEF_FILL = 9.999e20;

/** A value is real data (not nodata / non-finite). */
export function isDefined(v: number): boolean {
  return Number.isFinite(v) && Math.abs(v) < GRIB_UNDEFINED;
}

export interface MosaicTile {
  /** Tile values already regridded onto the SAME target grid, nodata outside. */
  values: Float32Array;
  /** Higher wins where tiles overlap. */
  priority: number;
}

/**
 * Composite tiles onto one grid of `n` pixels: for each pixel take the defined
 * value from the highest-priority tile that covers it; nodata where none do.
 * Pure — all tiles must already share the target grid/pixel order.
 */
export function mosaicByPriority(tiles: MosaicTile[], n: number): Float32Array {
  const out = new Float32Array(n);
  out.fill(UNDEF_FILL);
  const set = new Uint8Array(n);
  // Highest priority first: the first tile to define a pixel wins it.
  const ordered = [...tiles].sort((a, b) => b.priority - a.priority);
  for (const t of ordered) {
    for (let i = 0; i < n; i++) {
      if (set[i]) continue;
      const v = t.values[i];
      if (isDefined(v)) {
        out[i] = v;
        set[i] = 1;
      }
    }
  }
  return out;
}

/**
 * Feather the boundary between a higher-priority tile and the pixels a
 * lower-priority tile supplied, by linearly blending across a `margin`-pixel band
 * so nested edges don't hard-cut. `owner[i]` is the priority that supplied pixel
 * i (from a parallel mosaic pass); pixels with different owners within `margin`
 * get averaged. Kept simple/optional — same-model wave tiles rarely show a seam.
 */
export function blendSeams(
  values: Float32Array,
  owner: Int32Array,
  width: number,
  height: number,
  margin = 2,
): Float32Array {
  if (margin <= 0) return values;
  const out = Float32Array.from(values);
  const at = (r: number, c: number) => r * width + c;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = at(r, c);
      if (!isDefined(values[i])) continue;
      let sum = 0;
      let count = 0;
      let crossesBoundary = false;
      for (let dr = -margin; dr <= margin; dr++) {
        for (let dc = -margin; dc <= margin; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= height || cc < 0 || cc >= width) continue;
          const j = at(rr, cc);
          if (!isDefined(values[j])) continue;
          if (owner[j] !== owner[i]) crossesBoundary = true;
          sum += values[j];
          count++;
        }
      }
      if (crossesBoundary && count > 0) out[i] = sum / count;
    }
  }
  return out;
}

export type Wgrib2Runner = (args: string[]) => Promise<Buffer>;

/**
 * Regrid one tile GRIB2 onto the common global grid and return the field.
 * Runs `wgrib2 IN -match RE -new_grid_winds earth -new_grid <newgrid> OUT`, then
 * dumps OUT as raw Float32. `newgrid` is a wgrib2 grid spec, e.g.
 *   "latlon -180:2160:0.166667 -90:1081:0.166667".
 * Integration seam — needs the wgrib2 CLI; the runner is injectable for tests.
 */
export async function regridTileToGlobal(args: {
  gribPath: string;
  outPath: string;
  match: string;
  newgrid: string;
  width: number;
  height: number;
  runner?: Wgrib2Runner;
}): Promise<Wgrib2Grid> {
  const runner = args.runner ?? runWgrib2;
  await runner([
    args.gribPath,
    "-match",
    args.match,
    "-new_grid_winds",
    "earth",
    "-new_grid",
    ...args.newgrid.split(" "),
    args.outPath,
  ]);
  // Dump the regridded field as raw floats on the target grid.
  return extractField({ gribPath: args.outPath, width: args.width, height: args.height, runner });
}

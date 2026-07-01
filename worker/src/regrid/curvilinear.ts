// regrid/curvilinear.ts
// Resample a CURVILINEAR field (values on a 2-D lon/lat grid, e.g. RTOFS tripolar
// HYCOM) onto a REGULAR global lat-lon grid. Nearest-source binning: each source
// cell drops its value into the target cell its (lon,lat) falls in; the regular
// target then feeds the existing scalar/vector bake unchanged.
//
// Nearest-binning (not bilinear) is chosen deliberately: the tripolar source is
// FINER than the target (1/12° → 1/12° or coarser display grid), so several source
// cells map into each target cell and we keep the last/any — visually clean for a
// broadcast globe. Land/undefined source cells are skipped, leaving target nodata.

export const GRIB_UNDEFINED = 1e20;
const UNDEF_FILL = 9.999e20;

export function isDefined(v: number): boolean {
  return Number.isFinite(v) && Math.abs(v) < GRIB_UNDEFINED;
}

export interface RegularGridSpec {
  width: number;
  height: number;
  /** [west, south, east, north]; row 0 = north, col 0 = west. */
  bounds: [number, number, number, number];
}

/** Normalise a longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  if (x === 180) x = -180;
  return x;
}

/**
 * Map a (lon,lat) to a target row/col index on the regular grid, or -1 if out of
 * range. row 0 = north edge, col 0 = west edge.
 */
export function targetIndex(lon: number, lat: number, grid: RegularGridSpec): number {
  const [w, s, e, n] = grid.bounds;
  const L = wrapLon(lon);
  if (lat < s || lat > n) return -1;
  const dLon = (e - w) / grid.width;
  const dLat = (n - s) / grid.height;
  let col = Math.floor((L - w) / dLon);
  let row = Math.floor((n - lat) / dLat);
  if (col < 0) col = 0;
  if (col >= grid.width) col = grid.width - 1;
  if (row < 0) row = 0;
  if (row >= grid.height) row = grid.height - 1;
  return row * grid.width + col;
}

export interface CurvilinearField {
  /** Source values, row-major over the 2-D source grid. */
  values: Float32Array;
  /** Source longitudes, same length/order as values. */
  lon: Float32Array;
  /** Source latitudes, same length/order as values. */
  lat: Float32Array;
}

/**
 * Scatter a curvilinear field onto a regular grid. Returns Float32 on the target
 * grid, nodata (9.999e20) where no source cell landed. Pure.
 */
export function regridCurvilinear(src: CurvilinearField, grid: RegularGridSpec): Float32Array {
  const n = grid.width * grid.height;
  const out = new Float32Array(n);
  out.fill(UNDEF_FILL);
  const len = src.values.length;
  for (let i = 0; i < len; i++) {
    const v = src.values[i];
    if (!isDefined(v)) continue;
    const idx = targetIndex(src.lon[i], src.lat[i], grid);
    if (idx < 0) continue;
    out[idx] = v;
  }
  return out;
}

/**
 * Fill isolated nodata holes left by binning a fine source onto a similar-res
 * target (a few target cells may catch no source cell). Replaces a nodata cell
 * with the mean of its defined 4-neighbours; one pass, so genuine land/gaps
 * (large nodata regions) stay nodata. Pure.
 */
export function fillPinholes(values: Float32Array, width: number, height: number): Float32Array {
  const out = Float32Array.from(values);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c;
      if (isDefined(values[i])) continue;
      let sum = 0;
      let cnt = 0;
      const nb = [
        r > 0 ? i - width : -1,
        r < height - 1 ? i + width : -1,
        c > 0 ? i - 1 : -1,
        c < width - 1 ? i + 1 : -1,
      ];
      for (const j of nb) {
        if (j >= 0 && isDefined(values[j])) {
          sum += values[j];
          cnt++;
        }
      }
      // Only fill true pinholes: needs data on at least 3 of 4 sides.
      if (cnt >= 3) out[i] = sum / cnt;
    }
  }
  return out;
}

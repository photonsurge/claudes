// weather/sample.ts
// Pure point-sampling of baked weather textures: lat/lng → fractional pixel →
// bilinear byte sample → physical value via the frame's decode range. Mirrors
// the worker bake conventions exactly: row 0 = NORTH, column 0 = west edge,
// pixel centres at (west + x·res, north − y·res); scalars pack the value into
// R (=G=B), vectors pack u into R and v into G; alpha 0 marks nodata.
//
// PNG decoding is the caller's job (pngjs in Next, sharp in the worker) — this
// module only sees raw RGBA bytes, so it stays dependency-free and testable.

/** Decoded raster + the georeferencing needed to sample it. */
export interface SampleGrid {
  /** Raw RGBA bytes, row-major from the north-west corner. */
  rgba: Uint8Array;
  width: number;
  height: number;
  /** [west, south, east, north]. */
  bounds: number[];
  /** Degrees per pixel step (regular lat-lon grids only). */
  res: number;
}

/** Inverse of the bake-side scaleToByte — decode a byte to a physical value. */
export function byteToValue(byte: number, [min, max]: [number, number]): number {
  return min + (byte / 255) * (max - min);
}

/** Longitude normalised into −180..180. */
export function normalizeLng(lng: number): number {
  let l = ((lng + 180) % 360 + 360) % 360 - 180;
  if (l === -180 && lng >= 180) l = 180;
  return l;
}

/**
 * Map lat/lng to the frame's fractional pixel coordinates, or null when the
 * point falls outside its bounds. Global grids (≈360° span) wrap in longitude.
 */
export function latLngToPixel(
  lat: number,
  lng: number,
  grid: Pick<SampleGrid, "bounds" | "res" | "width" | "height">,
): { x: number; y: number } | null {
  const [west, south, east, north] = grid.bounds;
  if (lat < south || lat > north) return null;

  const global = Math.abs(east - west - 360) < grid.res;
  let x = (normalizeLng(lng) - west) / grid.res;
  if (global) {
    x = ((x % grid.width) + grid.width) % grid.width;
  } else if (x < 0 || x > grid.width - 1) {
    return null;
  }

  const y = (north - lat) / grid.res;
  if (y < 0 || y > grid.height - 1) return null;
  return { x, y };
}

/**
 * Bilinearly sample one RGBA channel at a fractional pixel. Corners with
 * alpha 0 are nodata: their weight is dropped and the rest renormalised;
 * all-nodata → null. Global grids wrap the east neighbour around the seam.
 */
export function bilinearChannel(
  grid: SampleGrid,
  x: number,
  y: number,
  channel: 0 | 1 | 2,
): number | null {
  const { rgba, width, height, bounds, res } = grid;
  const global = Math.abs(bounds[2] - bounds[0] - 360) < res;

  const x0 = Math.floor(x);
  const y0 = Math.min(Math.floor(y), height - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const x1raw = x0 + 1;
  const x0w = ((x0 % width) + width) % width;
  const x1 = global ? x1raw % width : Math.min(x1raw, width - 1);
  const fx = x - x0;
  const fy = y - y0;

  const corners: Array<{ px: number; py: number; w: number }> = [
    { px: x0w, py: y0, w: (1 - fx) * (1 - fy) },
    { px: x1, py: y0, w: fx * (1 - fy) },
    { px: x0w, py: y1, w: (1 - fx) * fy },
    { px: x1, py: y1, w: fx * fy },
  ];

  let sum = 0;
  let wsum = 0;
  for (const c of corners) {
    const o = (c.py * width + c.px) * 4;
    if (rgba[o + 3] === 0) continue; // nodata
    sum += rgba[o + channel] * c.w;
    wsum += c.w;
  }
  if (wsum <= 0) return null;
  return sum / wsum;
}

/** Everything sampleFrame needs to know about one archived frame. */
export interface FrameLike extends SampleGrid {
  encoding: "scalar" | "uv";
  imageUnscale?: [number, number];
  vectorUnscale?: [number, number];
}

export interface ScalarSample {
  kind: "scalar";
  value: number;
}

export interface VectorSample {
  kind: "uv";
  u: number;
  v: number;
  /** Magnitude in the variable's native units (e.g. m/s for wind). */
  speed: number;
}

export type FrameSample = ScalarSample | VectorSample;

/**
 * Sample a frame at lat/lng, decoding bytes back to physical values. Returns
 * null outside the frame's bounds, on nodata, or when the frame is missing its
 * decode range.
 */
export function sampleFrame(frame: FrameLike, lat: number, lng: number): FrameSample | null {
  const px = latLngToPixel(lat, lng, frame);
  if (!px) return null;

  if (frame.encoding === "scalar") {
    const unscale = frame.imageUnscale;
    if (!unscale) return null;
    const byte = bilinearChannel(frame, px.x, px.y, 0);
    if (byte == null) return null;
    return { kind: "scalar", value: byteToValue(byte, unscale) };
  }

  const unscale = frame.vectorUnscale ?? frame.imageUnscale;
  if (!unscale) return null;
  const ub = bilinearChannel(frame, px.x, px.y, 0);
  const vb = bilinearChannel(frame, px.x, px.y, 1);
  if (ub == null || vb == null) return null;
  const u = byteToValue(ub, unscale);
  const v = byteToValue(vb, unscale);
  return { kind: "uv", u, v, speed: Math.hypot(u, v) };
}

/** Spatial aggregate of one frame over an area. */
export interface AreaStats {
  mean: number;
  min: number;
  max: number;
  /** Pixels sampled (after nodata masking / striding). */
  count: number;
}

/**
 * Aggregate a frame's physical values over a [west,south,east,north] window:
 * mean/min/max across the covered pixels (uv frames aggregate SPEED). Nodata
 * (alpha 0) pixels are skipped; a window crossing the antimeridian on a global
 * grid wraps. Very large windows are strided down to ~`maxSamples` pixels so a
 * whole-hemisphere shot stays cheap. Null when the window misses the frame,
 * everything is nodata, or the frame lacks its decode range.
 */
export function areaStatsFrame(
  frame: FrameLike,
  bbox: [number, number, number, number],
  maxSamples = 50_000,
): AreaStats | null {
  const { width, height, bounds, res, rgba } = frame;
  const unscale = frame.encoding === "uv" ? frame.vectorUnscale ?? frame.imageUnscale : frame.imageUnscale;
  if (!unscale) return null;

  const [west, south, east, north] = bbox;
  const global = Math.abs(bounds[2] - bounds[0] - 360) < res;

  // Latitude rows (row 0 = north). Clamp to the frame; empty → miss.
  const y0 = Math.max(0, Math.ceil((bounds[3] - Math.min(north, bounds[3])) / res));
  const y1 = Math.min(height - 1, Math.floor((bounds[3] - Math.max(south, bounds[1])) / res));
  if (y1 < y0) return null;

  // Longitude columns; on a global grid the window may wrap the seam, so we
  // iterate `cols` steps from x0 with modulo. Regional grids clamp instead.
  let x0 = Math.ceil((normalizeLng(west) - bounds[0]) / res);
  let cols: number;
  if (global) {
    x0 = ((x0 % width) + width) % width;
    let span = normalizeLng(east) - normalizeLng(west);
    if (span < 0) span += 360;
    if (span === 0 && east !== west) span = 360; // whole-world window
    cols = Math.min(width, Math.floor(span / res) + 1);
  } else {
    const xEnd = Math.min(width - 1, Math.floor((normalizeLng(east) - bounds[0]) / res));
    x0 = Math.max(0, x0);
    if (xEnd < x0) return null;
    cols = xEnd - x0 + 1;
  }

  const rows = y1 - y0 + 1;
  const stride = Math.max(1, Math.ceil(Math.sqrt((rows * cols) / maxSamples)));

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let ry = y0; ry <= y1; ry += stride) {
    for (let cx = 0; cx < cols; cx += stride) {
      const px = global ? (x0 + cx) % width : x0 + cx;
      const o = (ry * width + px) * 4;
      if (rgba[o + 3] === 0) continue; // nodata
      let v: number;
      if (frame.encoding === "uv") {
        const u = byteToValue(rgba[o], unscale);
        const w = byteToValue(rgba[o + 1], unscale);
        v = Math.hypot(u, w);
      } else {
        v = byteToValue(rgba[o], unscale);
      }
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count += 1;
    }
  }
  if (count === 0) return null;
  return { mean: sum / count, min, max, count };
}

export interface SeriesStats {
  count: number;
  min: number;
  max: number;
  avg: number;
}

/** min/max/mean over the numeric values of a sampled series. Null when empty. */
export function seriesStats(values: number[]): SeriesStats | null {
  if (values.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { count: values.length, min, max, avg: sum / values.length };
}

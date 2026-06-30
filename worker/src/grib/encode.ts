// grib/encode.ts
// PURE encoding helpers + sharp-backed PNG encoders.
//
// Texture format (all PNG, no GeoTIFF / GDAL):
//  - Wind (uv): RGBA PNG. R = scaled u, G = scaled v, B = 0, A = 255.
//  - Scalar:    RGBA grayscale PNG. value packed into R=G=B, A = 255.
// Bytes are produced with `scaleToByte` over a per-variable `imageUnscale`
// decode range. Grids are width×height, row 0 = NORTH, column 0 = −180.

import sharp from "sharp";

/**
 * Linearly map `value` into a 0..255 byte over [min,max], clamped at both ends.
 * byte = round((value - min) / (max - min) * 255).
 */
export function scaleToByte(value: number, [min, max]: [number, number]): number {
  if (!Number.isFinite(value)) return 0;
  if (max === min) return 0;
  const t = (value - min) / (max - min);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.round(clamped * 255);
}

/** Inverse of scaleToByte — decode a byte back to a physical value. */
export function byteToValue(byte: number, [min, max]: [number, number]): number {
  return min + (byte / 255) * (max - min);
}

/**
 * Roll a row-major grid's columns by half its width so that a 0..360 longitude
 * grid (column 0 = 0°E) becomes a −180..180 grid (column 0 = −180°). Each row is
 * rotated independently by `floor(width/2)` columns.
 */
export function rollLongitude(values: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(values.length);
  const shift = Math.floor(width / 2);
  for (let row = 0; row < height; row++) {
    const base = row * width;
    for (let col = 0; col < width; col++) {
      // src column that lands at output column `col`
      const src = (col + shift) % width;
      out[base + col] = values[base + src];
    }
  }
  return out;
}

/**
 * De-accumulate an accumulated field (e.g. APCP) into a per-hour rate.
 * rate = (curr - prev) / deltaHours. When `prev` is undefined (f000 or the
 * first step of a new accumulation bucket), the rate is treated as 0.
 */
export function deaccumulate(
  curr: Float32Array,
  prev: Float32Array | undefined,
  deltaHours: number,
): Float32Array {
  const out = new Float32Array(curr.length);
  if (!prev || deltaHours <= 0) {
    // f000 / no previous bucket → zero rate.
    return out; // already all zeros
  }
  for (let i = 0; i < curr.length; i++) {
    const diff = curr[i] - prev[i];
    out[i] = diff > 0 ? diff / deltaHours : 0;
  }
  return out;
}

/** Build raw RGBA bytes for a wind (uv) texture. */
export function windRgba(
  u: Float32Array,
  v: Float32Array,
  width: number,
  height: number,
  imageUnscale: [number, number],
): Buffer {
  const n = width * height;
  const buf = Buffer.allocUnsafe(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    buf[o] = scaleToByte(u[i], imageUnscale);
    buf[o + 1] = scaleToByte(v[i], imageUnscale);
    buf[o + 2] = 0;
    buf[o + 3] = 255;
  }
  return buf;
}

/**
 * Build raw RGBA bytes for a scalar (grayscale) texture. When `keep` is given,
 * pixels where `keep[i]` is falsy are baked as nodata (alpha 0) — WeatherLayers
 * skips alpha-0 texels, which is how we mask SST to ocean, snow to land, etc.
 */
export function scalarRgba(
  values: Float32Array,
  width: number,
  height: number,
  imageUnscale: [number, number],
  keep?: ArrayLike<number>,
): Buffer {
  const n = width * height;
  const buf = Buffer.allocUnsafe(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const b = scaleToByte(values[i], imageUnscale);
    buf[o] = b;
    buf[o + 1] = b;
    buf[o + 2] = b;
    buf[o + 3] = keep && !keep[i] ? 0 : 255;
  }
  return buf;
}

/** Encode a wind (uv) RGBA PNG buffer via sharp. */
export async function encodeWindPng(
  u: Float32Array,
  v: Float32Array,
  width: number,
  height: number,
  imageUnscale: [number, number],
): Promise<Buffer> {
  const raw = windRgba(u, v, width, height, imageUnscale);
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/** Encode a scalar grayscale RGBA PNG buffer via sharp. `keep` masks nodata. */
export async function encodeScalarPng(
  values: Float32Array,
  width: number,
  height: number,
  imageUnscale: [number, number],
  keep?: ArrayLike<number>,
): Promise<Buffer> {
  const raw = scalarRgba(values, width, height, imageUnscale, keep);
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// weather/synthetic.ts
// Procedural field generators for the `seedSample` demo path. No network, no
// wgrib2 — just smooth analytic fields so /watch is demoable and the web is
// testable without external deps.
//
// Grids follow the same conventions as the real path: row-major, row 0 = NORTH
// (lat +90), column 0 = −180. Because these are generated directly in −180..180
// space they do NOT need rollLongitude before encoding.

export interface SyntheticGrid {
  u: Float32Array;
  v: Float32Array;
}

/** lat for image row (row 0 = +90 north, last row = −90 south). */
function latForRow(row: number, height: number): number {
  if (height === 1) return 0;
  return 90 - (row / (height - 1)) * 180;
}

/** lng for image column (col 0 = −180, last col approaches +180). */
function lngForCol(col: number, width: number): number {
  return -180 + (col / width) * 360;
}

const DEG = Math.PI / 180;

/**
 * Smooth swirling wind field. u/v are trig functions of lat/lng giving a
 * banded, rotating pattern in m/s (roughly ±30 m/s).
 */
export function syntheticWind(width: number, height: number): SyntheticGrid {
  const u = new Float32Array(width * height);
  const v = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = latForRow(row, height);
    for (let col = 0; col < width; col++) {
      const lng = lngForCol(col, width);
      const i = row * width + col;
      // Zonal flow that reverses with latitude bands + a longitudinal swirl.
      u[i] = 25 * Math.cos(lat * DEG * 3) * Math.cos(lng * DEG * 2);
      v[i] = 20 * Math.sin(lng * DEG * 2) * Math.cos(lat * DEG * 2);
    }
  }
  return { u, v };
}

/**
 * Latitude-based temperature gradient in °C: ~ +30 at the equator down to ~ −40
 * at the poles, with a mild longitudinal ripple.
 */
export function syntheticTemp(width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = latForRow(row, height);
    const base = 30 - 70 * Math.abs(lat) / 90;
    for (let col = 0; col < width; col++) {
      const lng = lngForCol(col, width);
      out[row * width + col] = base + 4 * Math.cos(lng * DEG * 3);
    }
  }
  return out;
}

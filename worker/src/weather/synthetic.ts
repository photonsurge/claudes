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

/**
 * A synthetic land-sea mask (1 = land, 0 = sea): a few smooth "continent" blobs
 * so the masking path is demoable offline. Same row/col conventions as the other
 * synthetic fields (already in −180..180, no longitude roll needed).
 */
export function syntheticLandMask(width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = latForRow(row, height);
    for (let col = 0; col < width; col++) {
      const lng = lngForCol(col, width);
      // Sum of broad lobes → land where the field rises above a threshold.
      const f =
        Math.cos(lng * DEG * 2) * Math.cos(lat * DEG * 2) +
        0.6 * Math.cos((lng + 90) * DEG) * Math.sin((lat + 20) * DEG);
      out[row * width + col] = f > 0.15 ? 1 : 0;
    }
  }
  return out;
}

/** Synthetic SST in °C: warm equatorial ocean (~28) → cold polar (~ −1). */
export function syntheticSst(width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = latForRow(row, height);
    const base = 28 - 30 * (Math.abs(lat) / 90);
    for (let col = 0; col < width; col++) {
      const lng = lngForCol(col, width);
      out[row * width + col] = Math.max(-1.8, base + 2 * Math.cos(lng * DEG * 2));
    }
  }
  return out;
}

const ABYSS_C = 1.5;
const THERMOCLINE_SCALE_M = 600;

/**
 * Synthetic temperature-at-depth: decays the surface `syntheticSst` field
 * toward an abyssal baseline via a single exponential — not calibrated to
 * real RTOFS values (see worker/src/sources/rtofsDepth.ts for the real,
 * live-calibrated per-depth domains), just plausible enough for a demo
 * profile shape (warm surface → near-freezing abyssal, everywhere).
 */
export function syntheticSstAtDepth(depth: number): (width: number, height: number) => Float32Array {
  return (width: number, height: number) => {
    const surface = syntheticSst(width, height);
    const decay = Math.exp(-depth / THERMOCLINE_SCALE_M);
    const out = new Float32Array(surface.length);
    for (let i = 0; i < surface.length; i++) out[i] = ABYSS_C + (surface[i] - ABYSS_C) * decay;
    return out;
  };
}

/** Synthetic cloud cover %: swirling bands 0..100. */
export function syntheticCloud(width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = latForRow(row, height);
    for (let col = 0; col < width; col++) {
      const lng = lngForCol(col, width);
      const s = Math.sin(lng * DEG * 3 + lat * DEG * 2) * Math.cos(lat * DEG * 3);
      out[row * width + col] = Math.max(0, Math.min(100, 50 + 50 * s));
    }
  }
  return out;
}

/** Synthetic significant wave height in m: calm tropics, big Southern Ocean swell. */
export function syntheticWave(width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = latForRow(row, height);
    // Roaring-forties style: swell builds with |lat|, peaks in the 40–60° belt.
    const belt = Math.max(0, 1 - Math.abs(Math.abs(lat) - 50) / 40);
    for (let col = 0; col < width; col++) {
      const lng = lngForCol(col, width);
      out[row * width + col] = Math.max(0, 1.5 + 7 * belt + 1.5 * Math.cos(lng * DEG * 3));
    }
  }
  return out;
}

/** Synthetic snow depth in cm: deep toward the poles, none near the equator. */
export function syntheticSnow(width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const lat = latForRow(row, height);
    const polar = Math.max(0, (Math.abs(lat) - 40) / 50); // 0 below 40°, →1 at poles
    for (let col = 0; col < width; col++) {
      const lng = lngForCol(col, width);
      out[row * width + col] = polar * (60 + 40 * Math.cos(lng * DEG * 4));
    }
  }
  return out;
}

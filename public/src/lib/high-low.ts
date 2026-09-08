/**
 * Pressure HIGH / LOW centres from a decoded scalar texture — what
 * WeatherLayers' HighLowLayer finds, computed here so the letters and values
 * can be drawn on the label canvas instead of two deck TextLayers. Those cost
 * the OBS main thread ~3.4 ms a frame (four luma draws, each re-uploading its
 * uniform blocks and re-binding the glyph atlas) — a tenth of a 33 ms frame for
 * a few dozen characters that never move relative to the globe.
 *
 * Pure: no DOM, no deck. Runs once per texture (the caller memoises), ~20–40 ms
 * for a global 0.25° grid.
 *
 * Method: decode the byte grid to physical values, box-blur it a little (an
 * 8-bit bake quantises a broad high into a flat plateau with no single
 * extremum; smoothing puts a dome back so its centre is found), take every
 * 3×3 local maximum / minimum as a candidate, then keep the strongest within
 * `radiusM` of each other (WeatherLayers' own suppression rule), coarsely
 * pre-bucketed so the pairwise pass stays small.
 */

export interface ScalarImage {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** [west, south, east, north] in degrees; image row 0 is the north edge. */
export type LngLatBounds = [number, number, number, number];

export interface HighLowPoint {
  type: "H" | "L";
  position: [number, number];
  /** Decoded physical value at the centre (hPa for pressure). */
  value: number;
}

const EARTH_RADIUS_M = 6_371_000;

/**
 * Box-blur half-width (cells) before extrema detection: about an eighth of the
 * separation radius, so a byte-quantised plateau narrower than that still ends
 * up with one strictly-highest cell at its centre. ~9 cells on the 0.25° GFS
 * grid at the 2 000 km default.
 */
export function smoothRadiusCells(radiusM: number, cellM: number): number {
  return Math.min(12, Math.max(1, Math.round(radiusM / cellM / 8)));
}

/** Channels per texel: 4 (RGBA), 2 (grey+alpha) or 1 (grey). */
function channelsOf(img: ScalarImage): number {
  const n = img.data.length / (img.width * img.height);
  return n >= 4 ? 4 : n >= 2 ? 2 : 1;
}

/** Byte grid → physical values via `unscale` ([min, max] for 0..255); NaN where alpha is 0. */
export function decodeScalar(img: ScalarImage, unscale: [number, number] | undefined): Float32Array {
  const { width, height, data } = img;
  const ch = channelsOf(img);
  const n = width * height;
  const out = new Float32Array(n);
  const lo = unscale ? unscale[0] : 0;
  const k = unscale ? (unscale[1] - unscale[0]) / 255 : 1;
  for (let i = 0; i < n; i++) {
    const o = i * ch;
    const a = ch === 4 ? data[o + 3] : ch === 2 ? data[o + 1] : 255;
    out[i] = a === 0 ? NaN : lo + data[o] * k;
  }
  return out;
}

/** Separable box blur (radius r cells), NaN-aware; wraps in x for a global grid. */
export function boxBlur(v: Float32Array, w: number, h: number, r: number, wrap: boolean): Float32Array {
  const tmp = new Float32Array(v.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let d = -r; d <= r; d++) {
        let xx = x + d;
        if (wrap) xx = (xx + w) % w;
        else if (xx < 0 || xx >= w) continue;
        const s = v[row + xx];
        if (s === s) {
          sum += s;
          cnt++;
        }
      }
      tmp[row + x] = cnt ? sum / cnt : NaN;
    }
  }
  const out = new Float32Array(v.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      let cnt = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        const s = tmp[yy * w + x];
        if (s === s) {
          sum += s;
          cnt++;
        }
      }
      out[y * w + x] = cnt ? sum / cnt : NaN;
    }
  }
  return out;
}

/** Great-circle distance in metres. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

interface Candidate {
  type: "H" | "L";
  position: [number, number];
  value: number;
}

/**
 * Keep, per type, the strongest candidate within `radiusM` of any other
 * (greedy, strongest first). Bucketed at half the radius first so a plateau's
 * rim of near-equal candidates collapses to one per bucket before the
 * pairwise pass.
 */
function suppress(cands: Candidate[], radiusM: number): HighLowPoint[] {
  const binDeg = Math.max(0.5, radiusM / 111_000 / 2);
  const best = new Map<string, Candidate>();
  for (const c of cands) {
    const key = `${c.type}|${Math.floor((c.position[1] + 90) / binDeg)}|${Math.floor((c.position[0] + 180) / binDeg)}`;
    const cur = best.get(key);
    if (!cur || (c.type === "H" ? c.value > cur.value : c.value < cur.value)) best.set(key, c);
  }
  const out: HighLowPoint[] = [];
  for (const type of ["H", "L"] as const) {
    const list = [...best.values()].filter((c) => c.type === type);
    list.sort((a, b) => (type === "H" ? b.value - a.value : a.value - b.value));
    const kept: Candidate[] = [];
    for (const c of list) {
      let clear = true;
      for (const k of kept) {
        if (haversineM(c.position, k.position) < radiusM) {
          clear = false;
          break;
        }
      }
      if (clear) {
        kept.push(c);
        out.push({ type, position: c.position, value: c.value });
      }
    }
  }
  return out;
}

/**
 * Find the pressure highs and lows of a scalar image. `radiusM` is the minimum
 * separation between centres of one type (WeatherLayers' `radius`, metres).
 */
export function findHighLows(
  img: ScalarImage,
  bounds: LngLatBounds,
  unscale: [number, number] | undefined,
  radiusM: number,
): HighLowPoint[] {
  const { width: w, height: h } = img;
  if (w < 3 || h < 3) return [];
  const [west, south, east, north] = bounds;
  const wrap = east - west >= 359.9;
  const raw = decodeScalar(img, unscale);
  const cellM = (111_000 * Math.abs(north - south)) / h;
  const s = boxBlur(raw, w, h, smoothRadiusCells(radiusM, cellM), wrap);
  const cands: Candidate[] = [];
  const x0 = wrap ? 0 : 2;
  const x1 = wrap ? w - 1 : w - 3;
  for (let y = 2; y < h - 2; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const c = s[i];
      if (c !== c) continue;
      // Extremum of the smoothed field: at least as high as its 8 neighbours
      // and STRICTLY higher than the ring two cells out. Ties among the inner
      // ring let a peak that straddles two cells through (suppression keeps
      // one of the pair); the strict outer ring rejects every flat cell that
      // merely sits beside a dip, which would otherwise ring each real low
      // with fake highs at the background value.
      let isMax = true;
      let isMin = true;
      let bad = false;
      for (let dy = -2; dy <= 2 && !bad && (isMax || isMin); dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!dx && !dy) continue;
          let xx = x + dx;
          if (wrap) xx = (xx + w) % w;
          const n = s[(y + dy) * w + xx];
          if (n !== n) {
            bad = true;
            break;
          }
          const inner = Math.max(dx < 0 ? -dx : dx, dy < 0 ? -dy : dy) === 1;
          if (inner ? n > c : n >= c) isMax = false;
          if (inner ? n < c : n <= c) isMin = false;
        }
      }
      if (bad || (!isMax && !isMin)) continue;
      const lng = west + ((x + 0.5) / w) * (east - west);
      const lat = north - ((y + 0.5) / h) * (north - south);
      const value = raw[i];
      if (value !== value) continue;
      cands.push({ type: isMax ? "H" : "L", position: [lng, lat], value });
    }
  }
  return suppress(cands, radiusM);
}

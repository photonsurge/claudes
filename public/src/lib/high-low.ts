/**
 * Pressure HIGH / LOW centres from a decoded scalar texture — what
 * WeatherLayers' HighLowLayer finds, computed here so the letters and values
 * can be drawn on the label canvas instead of two deck TextLayers. Those cost
 * the OBS main thread ~3.4 ms a frame (four luma draws, each re-uploading its
 * uniform blocks and re-binding the glyph atlas) — a tenth of a 33 ms frame for
 * a few dozen characters that never move relative to the globe.
 *
 * Pure: no DOM, no deck. Runs once per texture (the caller memoises) in a Web
 * Worker (lib/high-low.worker.ts): ~20–40 ms of work for a global 0.25° grid,
 * and a finer bake is first folded onto a search grid sized to the separation
 * radius (`workGridFactor`), its kept centres refined back onto the bake's own
 * cells — a 0.05° bake scanned at full resolution was ~2.4 s, and it ran on the
 * main thread inside Globe's render (docs/watch-perf-plan.md, round 18).
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
  /** Search-grid cell it was found in (for `refine`). */
  X: number;
  Y: number;
}

/**
 * Cells per separation radius the SEARCH grid needs. The field is smoothed over
 * an eighth of the radius before extrema are taken, so a grid finer than this
 * only multiplies the work (a 0.05° bake is 25× the cells of the 0.25° grid this
 * was sized for, and `smoothRadiusCells`' cap then under-smooths it as well).
 * 70 leaves the 2 000 km default on the 0.25° GFS grid unchanged (factor 1) and
 * folds 0.125° / 0.0625° / 0.05° bakes 2× / 4× / 5×.
 */
const WORK_CELLS_PER_RADIUS = 70;

/** Fine cells per search-grid cell for a bake of `cellM`-metre cells. */
export function workGridFactor(radiusM: number, cellM: number): number {
  return Math.max(1, Math.floor(radiusM / WORK_CELLS_PER_RADIUS / cellM));
}

/** NaN-aware block mean, `f`×`f` fine cells per work cell (the trailing remainder is dropped). */
export function downsample(v: Float32Array, w: number, f: number, wc: number, hc: number): Float32Array {
  const out = new Float32Array(wc * hc);
  for (let Y = 0; Y < hc; Y++) {
    for (let X = 0; X < wc; X++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (Y * f + dy) * w + X * f;
        for (let dx = 0; dx < f; dx++) {
          const s = v[row + dx];
          if (s === s) {
            sum += s;
            cnt++;
          }
        }
      }
      out[Y * wc + X] = cnt ? sum / cnt : NaN;
    }
  }
  return out;
}

/** Box mean of radius `r` around one cell of the full grid (NaN-aware; x wraps on a global grid). */
function boxMeanAt(v: Float32Array, w: number, h: number, x: number, y: number, r: number, wrap: boolean): number {
  let sum = 0;
  let cnt = 0;
  const y0 = Math.max(0, y - r);
  const y1 = Math.min(h - 1, y + r);
  for (let yy = y0; yy <= y1; yy++) {
    const row = yy * w;
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
  }
  return cnt ? sum / cnt : NaN;
}

/**
 * Put a centre found on the folded search grid back onto the bake's own cells:
 * among the fine cells under its work cell and the eight around it (a block
 * mean's extremum can sit a block over from the fine field's), take the one
 * whose locally smoothed value is the extremum, and report that cell's centre
 * and decoded value — what the full-resolution search reports.
 */
function refine(
  c: Candidate,
  raw: Float32Array,
  w: number,
  h: number,
  f: number,
  rf: number,
  wrap: boolean,
  [west, south, east, north]: LngLatBounds,
): HighLowPoint {
  const fx0 = (c.X - 1) * f;
  const fx1 = (c.X + 2) * f - 1;
  const fy0 = Math.max(0, (c.Y - 1) * f);
  const fy1 = Math.min(h - 1, (c.Y + 2) * f - 1);
  let bestI = -1;
  let bestV = NaN;
  for (let y = fy0; y <= fy1; y++) {
    for (let x = fx0; x <= fx1; x++) {
      let xx = x;
      if (wrap) xx = (xx + w) % w;
      else if (xx < 0 || xx >= w) continue;
      const i = y * w + xx;
      if (raw[i] !== raw[i]) continue;
      const v = boxMeanAt(raw, w, h, xx, y, rf, wrap);
      if (v !== v) continue;
      if (bestI < 0 || (c.type === "H" ? v > bestV : v < bestV)) {
        bestV = v;
        bestI = i;
      }
    }
  }
  if (bestI < 0) return { type: c.type, position: c.position, value: c.value };
  const x = bestI % w;
  const y = (bestI - x) / w;
  return {
    type: c.type,
    position: [west + ((x + 0.5) / w) * (east - west), north - ((y + 0.5) / h) * (north - south)],
    value: raw[bestI],
  };
}

/**
 * Keep, per type, the strongest candidate within `radiusM` of any other
 * (greedy, strongest first). Bucketed at half the radius first so a plateau's
 * rim of near-equal candidates collapses to one per bucket before the
 * pairwise pass.
 */
function suppress(cands: Candidate[], radiusM: number): Candidate[] {
  const binDeg = Math.max(0.5, radiusM / 111_000 / 2);
  const best = new Map<string, Candidate>();
  for (const c of cands) {
    const key = `${c.type}|${Math.floor((c.position[1] + 90) / binDeg)}|${Math.floor((c.position[0] + 180) / binDeg)}`;
    const cur = best.get(key);
    if (!cur || (c.type === "H" ? c.value > cur.value : c.value < cur.value)) best.set(key, c);
  }
  const out: Candidate[] = [];
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
        out.push(c);
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
  const cellM = (111_000 * Math.abs(bounds[3] - bounds[1])) / img.height;
  return findHighLowsAt(img, bounds, unscale, radiusM, workGridFactor(radiusM, cellM));
}

/** `findHighLows` with the search-grid factor fixed (1 = the bake's own grid); tests compare factors. */
export function findHighLowsAt(
  img: ScalarImage,
  bounds: LngLatBounds,
  unscale: [number, number] | undefined,
  radiusM: number,
  f: number,
): HighLowPoint[] {
  const { width: w, height: h } = img;
  if (w < 3 || h < 3) return [];
  const [west, south, east, north] = bounds;
  const wrap = east - west >= 359.9;
  const raw = decodeScalar(img, unscale);
  const cellM = (111_000 * Math.abs(north - south)) / h;
  // Search grid: the bake itself, or a block mean of it for a fine bake.
  const wc = Math.floor(w / f);
  const hc = Math.floor(h / f);
  if (wc < 3 || hc < 3) return [];
  const work = f === 1 ? raw : downsample(raw, w, f, wc, hc);
  const wrapW = wrap && wc * f === w; // a seam the fold no longer lines up on can't wrap
  const r = smoothRadiusCells(radiusM, cellM * f);
  const s = boxBlur(work, wc, hc, r, wrapW);
  const cands: Candidate[] = [];
  const x0 = wrapW ? 0 : 2;
  const x1 = wrapW ? wc - 1 : wc - 3;
  for (let Y = 2; Y < hc - 2; Y++) {
    for (let X = x0; X <= x1; X++) {
      const i = Y * wc + X;
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
          let xx = X + dx;
          if (wrapW) xx = (xx + wc) % wc;
          const n = s[(Y + dy) * wc + xx];
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
      // Decoded (unsmoothed) value and centre of the work cell — for f = 1 the
      // bake cell itself; for a fold, `refine` moves both onto the bake's cell.
      const value = work[i];
      if (value !== value) continue;
      const cx = X * f + (f - 1) / 2;
      const cy = Y * f + (f - 1) / 2;
      const lng = west + ((cx + 0.5) / w) * (east - west);
      const lat = north - ((cy + 0.5) / h) * (north - south);
      cands.push({ type: isMax ? "H" : "L", position: [lng, lat], value, X, Y });
    }
  }
  const kept = suppress(cands, radiusM);
  if (f === 1) return kept.map(({ type, position, value }) => ({ type, position, value }));
  const rf = Math.round(r * f); // the same physical smoothing, in fine cells
  return kept.map((c) => refine(c, raw, w, h, f, rf, wrap, bounds));
}

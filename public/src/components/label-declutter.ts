/**
 * The label canvas's per-frame decision as pure data in, pure data out: which
 * labels to draw this frame, in priority order, and whether each shows its
 * detail line. It walks the whole zoom-eligible list — view/hemisphere cull,
 * projection, progressive reveal, priority-ordered collision testing — which
 * is why it is kept free of DOM and React: label-declutter.worker.ts runs it
 * off the main thread on the previous frame's camera, and GlobeLabels runs it
 * inline when no decision is ready (the first frame after a label rebuild, or
 * no Worker at all).
 *
 * Screen positions are NOT part of the decision. The main thread projects the
 * chosen labels against the CURRENT frame's matrix, so positions are always
 * exact; a one-frame-old decision only means a label at the edge of a
 * collision appears or hides one frame later.
 */

/** Collision-box height of a name line (the old DOM row height). */
export const LABEL_H = 15;
const CHAR_W = 6.3;
const GRID_CELL = 48;
/** Detail chip height. */
export const DETAIL_H = 14;

/** Rough on-screen text width, so collision testing never needs a DOM read. */
export function labelWidth(text: string): number {
  return Math.min(240, 18 + text.length * CHAR_W);
}

/** Unit vector on the sphere for a lng/lat (degrees). */
export function unit(lng: number, lat: number): [number, number, number] {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  const cl = Math.cos(la);
  return [cl * Math.cos(lo), cl * Math.sin(lo), Math.sin(la)];
}

// ── Collision avoidance ───────────────────────────────────────────────────
// A dense conurbation (Barcelona's satellite towns, Madrid's suburbs …) can
// reveal a dozen same-tier labels within a few dozen pixels of each other.
// Each frame, labels are placed in priority order (biggest/capital first —
// `minZoom` is already that ranking) into a coarse screen-space grid; a label
// whose estimated box collides with an already-placed one is hidden (its dot,
// drawn by the separate deck.gl scatter layer, stays visible either way — only
// the crowded TEXT thins out, same as any decluttered map).

/** One 48 px cell's boxes for the current frame. `stamp` is the frame that last
 *  wrote it: `clear()` only bumps the grid's stamp, so the Map and every cell's
 *  array survive from frame to frame instead of being dropped and regrown.
 *  Rects are stored flat (x0, y0, x1, y1, …) for the same reason. */
type Cell = { stamp: number; rects: number[] };

export class LabelGrid {
  // Numeric cell keys: this runs per label per frame, and a `${cx},${cy}`
  // template string per cell was a measurable allocation + hash cost.
  private cells = new Map<number, Cell>();
  private stamp = 1;

  /** Forget this frame's boxes — O(1): cells with an older stamp read as empty. */
  clear() {
    this.stamp++;
  }

  /** True if the box overlaps anything already placed this frame. */
  collides(x0: number, y0: number, x1: number, y1: number): boolean {
    const cx0 = Math.floor(x0 / GRID_CELL);
    const cx1 = Math.floor(x1 / GRID_CELL);
    const cy0 = Math.floor(y0 / GRID_CELL);
    const cy1 = Math.floor(y1 / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.cells.get((cx + 32768) * 65536 + (cy + 32768));
        if (!cell || cell.stamp !== this.stamp) continue;
        const r = cell.rects;
        for (let i = 0; i < r.length; i += 4) {
          if (x0 < r[i + 2] && x1 > r[i] && y0 < r[i + 3] && y1 > r[i + 1]) return true;
        }
      }
    }
    return false;
  }

  place(x0: number, y0: number, x1: number, y1: number) {
    const cx0 = Math.floor(x0 / GRID_CELL);
    const cx1 = Math.floor(x1 / GRID_CELL);
    const cy0 = Math.floor(y0 / GRID_CELL);
    const cy1 = Math.floor(y1 / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = (cx + 32768) * 65536 + (cy + 32768);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = { stamp: this.stamp, rects: [] };
          this.cells.set(key, cell);
        } else if (cell.stamp !== this.stamp) {
          cell.stamp = this.stamp;
          cell.rects.length = 0;
        }
        cell.rects.push(x0, y0, x1, y1);
      }
    }
  }
}

// ── Projection ────────────────────────────────────────────────────────────
/** World → pixel through deck's pixelProjectionMatrix (column-major), perspective-divided. */
export function projectWorld(m: ArrayLike<number>, p: ArrayLike<number>, out: [number, number]): [number, number] {
  const x = p[0];
  const y = p[1];
  const z = p[2] ?? 0;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  return out;
}

/** Same, for the label at offset `o` (= 3 × index) of a flat world-position array. */
export function projectWorldAt(m: ArrayLike<number>, world: Float64Array, o: number, out: [number, number]): [number, number] {
  const x = world[o];
  const y = world[o + 1];
  const z = world[o + 2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  return out;
}

// ── The index: flat per-label arrays, in priority (minZoom) order ─────────
export const FLAG_CENTRED = 1;
export const FLAG_DETAIL = 2;

export interface LabelIndexData {
  n: number;
  /** Unit sphere vectors, 3 per label. */
  unit: Float64Array;
  /** `minZoom ?? 0` per label (Float64: an exact-equality zoom must compare as before). */
  minZoom: Float64Array;
  detailMinZoom: Float64Array;
  /** Collision-box widths of the name and the detail line (0 without one). */
  nameW: Float32Array;
  detailW: Float32Array;
  flags: Uint8Array;
  /** deck world positions, 3 per label — filled by the owner once it has a viewport. */
  world: Float64Array;
}

export interface IndexableLabel {
  position: [number, number, number];
  text: string;
  detail?: string;
  minZoom?: number;
  detailMinZoom?: number;
  align?: "left" | "center";
}

/** The arrays for an already priority-sorted label list. */
export function indexLabelData(sorted: IndexableLabel[]): LabelIndexData {
  const n = sorted.length;
  const d: LabelIndexData = {
    n,
    unit: new Float64Array(n * 3),
    minZoom: new Float64Array(n),
    detailMinZoom: new Float64Array(n),
    nameW: new Float32Array(n),
    detailW: new Float32Array(n),
    flags: new Uint8Array(n),
    world: new Float64Array(n * 3),
  };
  for (let i = 0; i < n; i++) {
    const l = sorted[i];
    const [x, y, z] = unit(l.position[0], l.position[1]);
    d.unit[i * 3] = x;
    d.unit[i * 3 + 1] = y;
    d.unit[i * 3 + 2] = z;
    d.minZoom[i] = l.minZoom ?? 0;
    d.detailMinZoom[i] = l.detailMinZoom ?? 0;
    d.nameW[i] = labelWidth(l.text);
    d.detailW[i] = l.detail ? labelWidth(l.detail) : 0;
    d.flags[i] = (l.align === "center" ? FLAG_CENTRED : 0) | (l.detail ? FLAG_DETAIL : 0);
  }
  return d;
}

// ── The per-frame decision ────────────────────────────────────────────────
export interface FrameParams {
  /** deck's pixelProjectionMatrix (null → the caller supplies `project`). */
  m: ArrayLike<number> | null;
  w: number;
  h: number;
  zoom: number;
  /** Sub-camera unit vector and the view-cull cosine floor (GlobeLabels `viewCosMin`). */
  cx: number;
  cy: number;
  cz: number;
  cosMin: number;
}

export interface Decision {
  /** Label indices to draw, in draw (priority) order. */
  chosen: Uint32Array;
  /** 1 where the label's detail line is shown, parallel to `chosen`. */
  detail: Uint8Array;
  considered: number;
  projected: number;
}

export function declutter(
  d: LabelIndexData,
  f: FrameParams,
  grid: LabelGrid,
  project?: (i: number) => ArrayLike<number>,
): Decision {
  grid.clear();
  const { n } = d;
  const chosen = new Uint32Array(n);
  const detail = new Uint8Array(n);
  const px: [number, number] = [0, 0];
  const { m, w, h, zoom, cx, cy, cz, cosMin } = f;
  let count = 0;
  let considered = 0;
  let projected = 0;
  for (let i = 0; i < n; i++) {
    // Progressive reveal: below the label's minZoom it's not shown at all —
    // and the list is sorted by minZoom, so the first one above the zoom
    // ends this frame's candidates.
    if (zoom < d.minZoom[i]) break;
    considered++;
    // Beyond the view's angular reach (or on the hidden hemisphere — the
    // 0.04 floor keeps a small margin so labels don't flicker at the limb).
    const j = i * 3;
    if (d.unit[j] * cx + d.unit[j + 1] * cy + d.unit[j + 2] * cz <= cosMin) continue;
    projected++;
    let x: number;
    let y: number;
    if (m) {
      projectWorldAt(m, d.world, j, px);
      x = px[0];
      y = px[1];
    } else if (project) {
      const p = project(i);
      x = p[0];
      y = p[1];
    } else continue;
    if (x < -160 || y < -50 || x > w + 160 || y > h + 50) continue;
    // Decluttering: skip (hide) this label if a higher-priority one already
    // claimed overlapping screen space this frame. Box is anchored the same
    // way the text is laid out — right of the point (or centred on it),
    // vertically centred.
    const centred = (d.flags[i] & FLAG_CENTRED) !== 0;
    const showDetail = (d.flags[i] & FLAG_DETAIL) !== 0 && zoom >= d.detailMinZoom[i];
    const boxW = centred ? Math.max(d.nameW[i], showDetail ? d.detailW[i] : 0) : d.nameW[i];
    const x0 = centred ? x - boxW / 2 : x;
    const y0 = y - LABEL_H / 2;
    const x1 = x0 + boxW;
    const y1 = y0 + LABEL_H + (centred && showDetail ? DETAIL_H : 0);
    if (grid.collides(x0, y0, x1, y1)) continue;
    grid.place(x0, y0, x1, y1);
    chosen[count] = i;
    detail[count] = showDetail ? 1 : 0;
    count++;
  }
  return { chosen: chosen.subarray(0, count), detail: detail.subarray(0, count), considered, projected };
}

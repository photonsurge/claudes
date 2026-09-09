import { LabelGrid, declutter, indexLabelData, projectWorldAt, type FrameParams, type IndexableLabel } from "./label-declutter";

/** Identity matrix: world coordinates ARE pixels, so tests can place labels directly. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const frame = (over: Partial<FrameParams> = {}): FrameParams => ({
  m: IDENTITY,
  w: 800,
  h: 600,
  zoom: 5,
  cx: 1,
  cy: 0,
  cz: 0,
  cosMin: 0.04,
  ...over,
});

/** A label at lng/lat 0/0 (facing the camera at +x) whose world position is the given pixel. */
function label(text: string, x: number, y: number, extra: Partial<IndexableLabel> = {}): IndexableLabel & { px: [number, number] } {
  return { position: [0, 0, 0], text, px: [x, y], ...extra };
}
function index(labels: ReturnType<typeof label>[]) {
  const d = indexLabelData(labels);
  labels.forEach((l, i) => {
    d.world[i * 3] = l.px[0];
    d.world[i * 3 + 1] = l.px[1];
  });
  return d;
}

describe("indexLabelData", () => {
  it("records widths, flags and zoom thresholds per label", () => {
    const d = indexLabelData([
      label("Paris", 0, 0, { detail: "France · 2.1M", detailMinZoom: 4 }),
      label("H", 0, 0, { align: "center" }),
    ]);
    expect(d.n).toBe(2);
    expect(d.nameW[0]).toBeGreaterThan(d.nameW[1]);
    expect(d.detailW[0]).toBeGreaterThan(0);
    expect(d.detailW[1]).toBe(0);
    expect(d.flags[0]).toBe(2); // detail
    expect(d.flags[1]).toBe(1); // centred
    expect(d.detailMinZoom[0]).toBe(4);
    expect(d.minZoom[1]).toBe(0);
  });
});

describe("declutter", () => {
  it("keeps the first of two overlapping labels and drops the one off screen", () => {
    const d = index([label("A", 100, 100), label("B", 110, 104), label("C", 400, 300), label("D", 2000, 100)]);
    const r = declutter(d, frame(), new LabelGrid());
    expect(Array.from(r.chosen)).toEqual([0, 2]);
    expect(r.considered).toBe(4);
    expect(r.projected).toBe(4);
  });

  it("shows the detail line only from detailMinZoom, and widens a centred box for it", () => {
    const d = index([
      label("H", 100, 100, { align: "center", detail: "1032", detailMinZoom: 3 }),
      // Just under the centred label's name box (y 92.5–107.5): its own box starts
      // at 108.5, so it only collides once the detail row (14 px) is added.
      label("x", 100, 116),
    ]);
    const low = declutter(d, frame({ zoom: 2 }), new LabelGrid());
    expect(Array.from(low.detail)).toEqual([0, 0]);
    expect(Array.from(low.chosen)).toEqual([0, 1]);
    const high = declutter(d, frame({ zoom: 5 }), new LabelGrid());
    expect(Array.from(high.chosen)).toEqual([0]);
    expect(Array.from(high.detail)).toEqual([1]);
  });

  it("stops at the first label above the zoom (the list is minZoom-sorted) and culls the far side", () => {
    const far = label("far", 100, 100);
    const d = index([label("a", 100, 100), label("b", 300, 100, { minZoom: 6 }), far]);
    // `far` sits at lng 180 → unit vector -x, behind the camera.
    d.unit[6] = -1;
    d.unit[7] = 0;
    d.unit[8] = 0;
    const r = declutter(d, frame({ zoom: 5 }), new LabelGrid());
    expect(Array.from(r.chosen)).toEqual([0]);
    expect(r.considered).toBe(1);
  });

  it("uses the caller's projection when there is no matrix", () => {
    const d = index([label("a", 0, 0), label("b", 0, 0)]);
    const r = declutter(d, frame({ m: null }), new LabelGrid(), (i) => [50 + i * 300, 50]);
    expect(Array.from(r.chosen)).toEqual([0, 1]);
    expect(declutter(d, frame({ m: null }), new LabelGrid()).chosen.length).toBe(0);
  });

  it("projectWorldAt matches a perspective divide", () => {
    const m = IDENTITY.slice();
    m[15] = 2; // w = 2 → halves x and y
    const out: [number, number] = [0, 0];
    projectWorldAt(m, new Float64Array([0, 0, 0, 100, 60, 0]), 3, out);
    expect(out).toEqual([50, 30]);
  });
});

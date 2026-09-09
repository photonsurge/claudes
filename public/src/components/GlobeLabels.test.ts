import { LabelGrid, holderLabels, iconSig, iconVarsOf, indexLabels, labelWidth, viewCosMin, type OverlayLabel } from "./GlobeLabels";

describe("viewCosMin (pre-projection view culling)", () => {
  const cam: [number, number, number] = [1, 0, 0]; // sub-camera point at lng 0, lat 0

  it("tightens to the corners' angular reach on a zoomed shot", () => {
    // Corners unproject to ±3° around the camera → reach ≈ 3°·√2, widened by a
    // quarter plus a degree ≈ 6.3° → cos ≈ 0.994: far more selective than 0.04.
    const vp = { unproject: ([x, y]: number[]) => [x ? 3 : -3, y ? 3 : -3] };
    const c = viewCosMin(vp, 100, 100, cam);
    expect(c).toBeGreaterThan(0.99);
    expect(c).toBeLessThan(1);
  });

  it("falls back to the hemisphere floor on a whole-globe shot or without unproject()", () => {
    // Corners land on the limb (90° away) → floor.
    const limb = { unproject: () => [90, 0] };
    expect(viewCosMin(limb, 100, 100, cam)).toBe(0.04);
    expect(viewCosMin({}, 100, 100, cam)).toBe(0.04);
    // A corner that can't be unprojected → floor too.
    const nan = { unproject: () => [NaN, NaN] };
    expect(viewCosMin(nan, 100, 100, cam)).toBe(0.04);
  });
});

describe("indexLabels (the frame loop's sorted, flat label list)", () => {
  const label = (id: string, lng: number, lat: number, minZoom?: number): OverlayLabel => ({
    id,
    text: id,
    position: [lng, lat, 0],
    color: [255, 255, 255],
    minZoom,
  });

  it("sorts by minZoom (undefined = 0) and lays unit vectors out in that order", () => {
    const idx = indexLabels([label("c", 0, 90, 4.5), label("a", 0, 0), label("b", 90, 0, 2)]);
    expect(idx.labels.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(Array.from(idx.data.minZoom)).toEqual([0, 2, 4.5]);
    // a: lng 0 lat 0 → +x; b: lng 90 → +y; c: lat 90 → +z.
    expect(Array.from(idx.data.unit.slice(0, 3)).map((v) => Math.round(v))).toEqual([1, 0, 0]);
    expect(Array.from(idx.data.unit.slice(3, 6)).map((v) => Math.round(v))).toEqual([0, 1, 0]);
    expect(Array.from(idx.data.unit.slice(6, 9)).map((v) => Math.round(v))).toEqual([0, 0, 1]);
    // Generations are distinct per rebuild; world positions wait for a viewport.
    expect(indexLabels([]).gen).toBeGreaterThan(idx.gen);
    expect(idx.worldCtor).toBeNull();
  });

  it("keeps a fractional minZoom exact, so a zoom equal to it still reveals the label", () => {
    const idx = indexLabels([label("x", 0, 0, 3.7)]);
    expect(3.7 < idx.data.minZoom[0]).toBe(false);
  });
});

describe("keyed icon sprites", () => {
  const resolve = (name: string, fallback: string) =>
    ({ "--gods-accent": "#43d9ff", "--gods-muted": "#c8d5e6" })[name] ?? fallback;

  it("iconVarsOf lists each custom property an icon's markup reads, once", () => {
    const svg = '<svg><path stroke="var(--gods-accent, #43d9ff)"/><circle fill="var(--gods-accent, #fff)" stroke="var(--gods-muted, #ccc)"/></svg>';
    expect(iconVarsOf(svg)).toEqual(["--gods-accent", "--gods-muted"]);
    expect(iconVarsOf("<svg><path stroke='#fff'/></svg>")).toEqual([]);
  });

  it("iconSig is null before a key's variables are known, then bakes their current values", () => {
    expect(iconSig("heartbeat:on", 1, undefined, resolve)).toBeNull();
    expect(iconSig("heartbeat:on", 1, ["--gods-accent"], resolve)).toBe("heartbeat:on|1|#43d9ff");
    // A theme change (new accent) is a different signature → a fresh sprite.
    const other = (n: string, f: string) => (n === "--gods-accent" ? "#f43f5e" : f);
    expect(iconSig("heartbeat:on", 1, ["--gods-accent"], other)).toBe("heartbeat:on|1|#f43f5e");
    // No variables at all → the key + dpr alone.
    expect(iconSig("pin:#fff", 2, [], resolve)).toBe("pin:#fff|2|");
  });

  it("holderLabels keeps keyless icons and keyed ones whose look has no sprite yet", () => {
    const label = (id: string, iconKey?: string): OverlayLabel => ({
      id,
      text: id,
      position: [0, 0, 0],
      color: [255, 255, 255],
      icon: null,
      iconKey,
    });
    const labels = [label("a"), label("b", "heartbeat:on"), label("c", "heartbeat:on")];
    // Nothing rasterised yet → every icon label still needs its holder.
    expect(holderLabels(labels, null, 0).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("labelWidth", () => {
  it("grows with text length", () => {
    expect(labelWidth("A")).toBeLessThan(labelWidth("A Longer City Name"));
  });

  it("caps at a max width", () => {
    expect(labelWidth("A".repeat(200))).toBe(240);
  });
});

describe("LabelGrid", () => {
  it("reports no collision for an empty grid", () => {
    const grid = new LabelGrid();
    expect(grid.collides(0, 0, 50, 15)).toBe(false);
  });

  it("collides with an overlapping placed box", () => {
    const grid = new LabelGrid();
    grid.place(100, 100, 160, 115);
    expect(grid.collides(120, 105, 180, 120)).toBe(true);
  });

  it("does not collide with a far-away placed box", () => {
    const grid = new LabelGrid();
    grid.place(100, 100, 160, 115);
    expect(grid.collides(500, 500, 560, 515)).toBe(false);
  });

  it("does not collide with a box that only touches (no overlap area)", () => {
    const grid = new LabelGrid();
    grid.place(0, 0, 50, 15);
    expect(grid.collides(50, 0, 100, 15)).toBe(false);
  });

  it("clear() removes previously placed boxes", () => {
    const grid = new LabelGrid();
    grid.place(0, 0, 50, 15);
    grid.clear();
    expect(grid.collides(0, 0, 50, 15)).toBe(false);
  });

  it("reuses cells across frames without leaking the previous frame's boxes", () => {
    const grid = new LabelGrid();
    grid.place(0, 0, 20, 10); // frame 1, cell (0,0)
    grid.clear();
    grid.place(25, 20, 45, 30); // frame 2, same cell, disjoint box
    expect(grid.collides(0, 0, 20, 10)).toBe(false); // frame 1's box is gone
    expect(grid.collides(30, 22, 40, 28)).toBe(true); // frame 2's is live
    grid.clear();
    expect(grid.collides(30, 22, 40, 28)).toBe(false);
  });

  it("detects collisions across grid-cell boundaries", () => {
    const grid = new LabelGrid();
    // A wide box spanning several 48px cells.
    grid.place(40, 0, 260, 15);
    expect(grid.collides(250, 0, 300, 15)).toBe(true);
  });
});

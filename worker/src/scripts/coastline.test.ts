import { rings, coastlineSvg, type Ring } from "./coastline";

describe("rings", () => {
  it("returns a Polygon's rings as-is", () => {
    const r = rings({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] });
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual([[0, 0], [1, 1]]);
  });
  it("flattens a MultiPolygon's rings", () => {
    const r = rings({ type: "MultiPolygon", coordinates: [[[[0, 0]]], [[[1, 1]]]] });
    expect(r).toHaveLength(2);
  });
  it("returns [] for non-polygon geometry", () => {
    expect(rings({ type: "LineString", coordinates: [[0, 0]] })).toEqual([]);
  });
});

describe("coastlineSvg", () => {
  const bbox: [number, number, number, number] = [-10, 40, 10, 60]; // 20°×20°

  it("projects a lon/lat to the expected pixel (plate-carrée)", () => {
    // Centre of the bbox → centre of a 100×100 raster (≈ (49.5, 49.5) at w-1=99).
    const ring: Ring = [[0, 50], [0.001, 50]];
    const svg = coastlineSvg([ring], bbox, 100, 100).toString();
    expect(svg).toContain('width="100" height="100"');
    expect(svg).toMatch(/49\.5,49\.5/);
  });

  it("drops points well outside the bbox (nothing to draw → no polyline)", () => {
    const far: Ring = [[170, -80], [171, -80]]; // Pacific, nowhere near [-10..10, 40..60]
    const svg = coastlineSvg([far], bbox, 100, 100).toString();
    expect(svg).not.toContain("<polyline");
  });

  it("wraps western lons into an antimeridian-crossing window (east > 180)", () => {
    // rtofs-bering-style window: 155°E → 211°E (i.e. 155°E → 151°W).
    const bering: [number, number, number, number] = [155, 40, 211, 67.2];
    // A ring straddling the dateline: one point at 160°E, one at −160°E (= 200° ascending).
    const straddle: Ring = [[160, 55], [-160, 55]];
    const svg = coastlineSvg([straddle], bering, 100, 100).toString();
    // Both points fall inside the wrapped frame → a 2-point polyline is emitted.
    expect(svg).toContain("<polyline");
    // Without the +360 wrap the −160 point would be filtered out (< west−2), so assert
    // the polyline carries two coordinate pairs.
    const pts = svg.match(/points="([^"]+)"/)?.[1] ?? "";
    expect(pts.trim().split(/\s+/)).toHaveLength(2);
  });
});

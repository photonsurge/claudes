import { signedArea, closeRing, windRing, windGeometry } from "./rings";

const CCW: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const CW: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];

describe("signedArea", () => {
  it("is positive for counter-clockwise and negative for clockwise", () => {
    expect(signedArea(CCW)).toBeGreaterThan(0);
    expect(signedArea(CW)).toBeLessThan(0);
  });
});

describe("closeRing", () => {
  it("closes an open ring", () => {
    const r = closeRing([[0, 0], [1, 0], [1, 1]]);
    expect(r[r.length - 1]).toEqual([0, 0]);
  });

  it("drops adjacent duplicate vertices (2dsphere rejects them)", () => {
    expect(closeRing([[0, 0], [0, 0], [1, 0], [1, 1], [1, 1]])).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });

  it("leaves an already-closed ring alone", () => {
    expect(closeRing(CCW)).toEqual(CCW);
  });
});

describe("windRing", () => {
  it("forces the requested winding", () => {
    expect(signedArea(windRing(CW, true)!)).toBeGreaterThan(0);
    expect(signedArea(windRing(CCW, false)!)).toBeLessThan(0);
  });

  it("keeps a ring that already winds correctly", () => {
    expect(windRing(CCW, true)).toEqual(CCW);
  });

  it("rejects a degenerate ring rather than emitting a bad polygon", () => {
    expect(windRing([[0, 0], [1, 1]], true)).toBeNull();
    expect(windRing([[0, 0], [0, 0], [0, 0]], true)).toBeNull();
  });
});

describe("windGeometry", () => {
  it("winds a Polygon's outer ring CCW", () => {
    const g = windGeometry({ type: "Polygon", coordinates: [CW] })!;
    expect(signedArea((g.coordinates as [number, number][][])[0])).toBeGreaterThan(0);
  });

  it("winds holes CW while keeping the outer ring CCW", () => {
    const hole: [number, number][] = [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4], [0.2, 0.2]];
    const g = windGeometry({ type: "Polygon", coordinates: [CW, hole] })!;
    const rings = g.coordinates as [number, number][][];
    expect(signedArea(rings[0])).toBeGreaterThan(0);
    expect(signedArea(rings[1])).toBeLessThan(0);
  });

  it("winds every part of a MultiPolygon", () => {
    const g = windGeometry({ type: "MultiPolygon", coordinates: [[CW], [CW]] })!;
    for (const part of g.coordinates as [number, number][][][]) {
      expect(signedArea(part[0])).toBeGreaterThan(0);
    }
  });

  it("passes a Point through untouched", () => {
    const pt = { type: "Point", coordinates: [1, 2] };
    expect(windGeometry(pt)).toEqual(pt);
  });

  it("returns null for empty/degenerate input so callers can fall back", () => {
    expect(windGeometry(null)).toBeNull();
    expect(windGeometry({ type: "Polygon", coordinates: [] })).toBeNull();
    expect(windGeometry({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] })).toBeNull();
  });
});

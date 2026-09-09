import { NO_PARTS, NO_RINGS, outlineRings, pickedFeature, polygonParts } from "./outline-rings";

const OUTER = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];
const HOLE = [
  [4, 4],
  [6, 4],
  [6, 6],
  [4, 6],
  [4, 4],
];
const EAST = [
  [20, 0],
  [30, 0],
  [30, 10],
  [20, 0],
];

const polygon = { id: "p", geometry: { type: "Polygon", coordinates: [OUTER, HOLE] } };
const multi = { id: "m", geometry: { type: "MultiPolygon", coordinates: [[OUTER], [EAST]] } };
const point = { id: "pt", geometry: { type: "Point", coordinates: [1, 2] } };
const bare = { id: "b", geometry: null };

describe("outlineRings", () => {
  it("emits every ring of a Polygon (outer then holes) tagged with its feature", () => {
    const rings = outlineRings([polygon]);
    expect(rings.map((r) => r.path)).toEqual([OUTER, HOLE]);
    expect(rings.every((r) => r.feature === polygon)).toBe(true);
  });

  it("flattens a MultiPolygon's parts in order and skips non-polygon geometry", () => {
    const rings = outlineRings([point, multi, bare]);
    expect(rings.map((r) => r.path)).toEqual([OUTER, EAST]);
    expect(rings.every((r) => r.feature === multi)).toBe(true);
  });

  it("hands back the SAME array for the same features reference (deck data identity)", () => {
    const features = [polygon, multi];
    const a = outlineRings(features);
    expect(outlineRings(features)).toBe(a);
    // A new array — even with the same members — is a new data reference.
    expect(outlineRings([polygon, multi])).not.toBe(a);
  });

  it("uses one shared empty list for nothing, never a fresh []", () => {
    expect(outlineRings([])).toBe(NO_RINGS);
    expect(outlineRings([])).toBe(outlineRings([]));
  });

  it("keeps the ring arrays themselves (no copy) so a 4 MB outline is not duplicated", () => {
    expect(outlineRings([polygon])[0].path).toBe(OUTER);
  });
});

describe("polygonParts", () => {
  it("is one part for a Polygon and one per member for a MultiPolygon, memoised per feature", () => {
    expect(polygonParts(polygon)).toEqual([[OUTER, HOLE]]);
    expect(polygonParts(multi)).toEqual([[OUTER], [EAST]]);
    expect(polygonParts(multi)).toBe(polygonParts(multi));
  });

  it("is the shared empty list for a point or a missing geometry", () => {
    expect(polygonParts(point)).toBe(NO_PARTS);
    expect(polygonParts(bare)).toBe(NO_PARTS);
  });
});

describe("pickedFeature", () => {
  it("unwraps a ring datum to its feature and passes anything else through", () => {
    const ring = outlineRings([polygon])[0];
    expect(pickedFeature(ring)).toBe(polygon);
    expect(pickedFeature(polygon)).toBe(polygon);
    const quake = { lng: 1, lat: 2, mag: 5 };
    expect(pickedFeature(quake)).toBe(quake);
  });

  it("is null for nothing picked", () => {
    expect(pickedFeature(undefined)).toBeNull();
    expect(pickedFeature(null)).toBeNull();
    expect(pickedFeature("x")).toBeNull();
  });
});

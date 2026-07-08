import { pointInPolygon, type SimplePolygon, type SimpleMultiPolygon } from "./pointInPolygon";

const SQUARE: SimplePolygon = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ],
};

describe("pointInPolygon — Polygon", () => {
  it("is true for a point well inside", () => {
    expect(pointInPolygon(5, 5, SQUARE)).toBe(true);
  });

  it("is false for a point well outside", () => {
    expect(pointInPolygon(20, 20, SQUARE)).toBe(false);
  });

  it("is false for a point inside a hole", () => {
    const withHole: SimplePolygon = {
      type: "Polygon",
      coordinates: [
        SQUARE.coordinates[0],
        [
          [3, 3],
          [7, 3],
          [7, 7],
          [3, 7],
          [3, 3],
        ],
      ],
    };
    expect(pointInPolygon(5, 5, withHole)).toBe(false); // in the hole
    expect(pointInPolygon(1, 1, withHole)).toBe(true); // inside outer, outside hole
  });
});

describe("pointInPolygon — MultiPolygon", () => {
  const MULTI: SimpleMultiPolygon = {
    type: "MultiPolygon",
    coordinates: [
      SQUARE.coordinates,
      [
        [
          [100, 100],
          [110, 100],
          [110, 110],
          [100, 110],
          [100, 100],
        ],
      ],
    ],
  };

  it("is true when inside any constituent polygon", () => {
    expect(pointInPolygon(5, 5, MULTI)).toBe(true);
    expect(pointInPolygon(105, 105, MULTI)).toBe(true);
  });

  it("is false when outside every constituent polygon", () => {
    expect(pointInPolygon(50, 50, MULTI)).toBe(false);
  });
});

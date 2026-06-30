import { alertRepPoint, continentOf } from "./geo";

describe("continentOf", () => {
  const cases: [string, number, number, string][] = [
    ["Kazakhstan forestfire", 82.4, 50.6, "Asia"],
    ["Kansas, US", -98, 39, "North America"],
    ["Mexico City", -99, 19, "North America"],
    ["Brazil", -47, -15, "South America"],
    ["Paris", 2.3, 48.9, "Europe"],
    ["Nigeria", 8, 9, "Africa"],
    ["Saudi Arabia", 45, 24, "Asia"],
    ["India", 78, 22, "Asia"],
    ["Australia", 134, -25, "Oceania"],
    ["Antarctica", 0, -75, "Antarctica"],
  ];
  it.each(cases)("places %s", (_name, lng, lat, expected) => {
    expect(continentOf(lng, lat)).toBe(expected);
  });

  it("returns undefined for non-finite input", () => {
    expect(continentOf(NaN, 10)).toBeUndefined();
  });
});

describe("alertRepPoint", () => {
  it("returns a Point coordinate as-is", () => {
    expect(alertRepPoint({ type: "Point", coordinates: [10, 20] })).toEqual([10, 20]);
  });

  it("averages the outer ring of a polygon (closing vertex included)", () => {
    const center = alertRepPoint({
      type: "Polygon",
      coordinates: [[[-90, 25], [-88, 25], [-88, 27], [-90, 27], [-90, 25]]],
    });
    expect(center![0]).toBeCloseTo(-89.2, 1);
    expect(center![1]).toBeCloseTo(25.8, 1);
  });

  it("ignores interior rings (holes) — a hole must not drag the point off the blob", () => {
    const outerOnly = alertRepPoint({
      type: "Polygon",
      coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    });
    const withHole = alertRepPoint({
      type: "Polygon",
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[100, 100], [101, 100], [101, 101], [100, 100]], // absurd hole far away
      ],
    });
    expect(withHole).toEqual(outerOnly);
  });

  it("frames the first part of a MultiPolygon, not the mean of all parts", () => {
    const center = alertRepPoint({
      type: "MultiPolygon",
      coordinates: [
        [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
        [[[200, 200], [201, 200], [201, 201], [200, 200]]], // far second part
      ],
    });
    // First part's outer ring centroid ≈ (0.8, 0.8) — the far part is ignored.
    expect(center![0]).toBeLessThan(2);
    expect(center![1]).toBeLessThan(2);
  });

  it("returns null for geometry without coordinates", () => {
    expect(alertRepPoint(null)).toBeNull();
    expect(alertRepPoint({ type: "Polygon" })).toBeNull();
  });
});

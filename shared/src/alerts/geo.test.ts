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
    // The Africa box's edges — the Levant, the Red Sea's two shores, the
    // Mediterranean's islands and Anatolia all used to read as Africa / Europe.
    ["Kinarot Valley, Israel", 35.5, 32.8, "Asia"],
    ["Beirut", 35.5, 33.9, "Asia"],
    ["Gaza", 34.45, 31.5, "Asia"],
    ["Aqaba", 35.0, 29.5, "Asia"],
    ["Jeddah", 39.2, 21.5, "Asia"],
    ["Cairo", 31.2, 30.05, "Africa"],
    ["Alexandria", 29.9, 31.2, "Africa"],
    ["Hurghada", 33.8, 27.3, "Africa"],
    ["Port Sudan", 37.2, 19.6, "Africa"],
    ["Massawa", 39.45, 15.6, "Africa"],
    ["Hodeidah, Yemen", 42.95, 14.8, "Asia"],
    ["Khartoum", 32.5, 15.6, "Africa"],
    ["Crete", 25.0, 35.2, "Europe"],
    ["Malta", 14.5, 35.9, "Europe"],
    ["Tunis", 10.2, 36.8, "Africa"],
    ["Tangier", -5.8, 35.8, "Africa"],
    ["Tarifa, Spain", -5.6, 36.0, "Europe"],
    ["Cyprus", 33.4, 35.1, "Asia"],
    ["Antalya", 30.7, 36.9, "Asia"],
    ["Ankara", 32.9, 39.9, "Asia"],
    ["Tbilisi", 44.8, 41.7, "Asia"],
    ["Athens", 23.7, 38.0, "Europe"],
    ["Crimea", 34.0, 45.0, "Europe"],
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

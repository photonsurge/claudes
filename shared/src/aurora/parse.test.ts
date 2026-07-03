import { parseOvation, AURORA_GRID_W, AURORA_GRID_H } from "./ovation";

/** Index into the row-major grid: row 0 = north (lat +90), col 0 = lng 0°E. */
const idx = (lng: number, lat: number) => (90 - lat) * AURORA_GRID_W + lng;

describe("parseOvation", () => {
  it("places probabilities on the fixed 1° lattice, north-first", () => {
    const g = parseOvation({
      "Observation Time": "2026-07-03T01:32:00Z",
      "Forecast Time": "2026-07-03T02:41:00Z",
      coordinates: [
        [0, 90, 5], // north pole, prime meridian → row 0, col 0
        [10, -90, 7], // south pole → last row
        [359, 0, 12], // equator, far east column
      ],
    });
    expect(g.width).toBe(AURORA_GRID_W);
    expect(g.height).toBe(AURORA_GRID_H);
    expect(g.values.length).toBe(AURORA_GRID_W * AURORA_GRID_H);
    expect(g.values[idx(0, 90)]).toBe(5);
    expect(g.values[idx(10, -90)]).toBe(7);
    expect(g.values[idx(359, 0)]).toBe(12);
    expect(g.observationTime).toBe("2026-07-03T01:32:00Z");
    expect(g.forecastTime).toBe("2026-07-03T02:41:00Z");
  });

  it("reports the peak probability and defaults empty cells to 0", () => {
    const g = parseOvation({ coordinates: [[0, 60, 3], [1, 60, 42], [2, 60, 18]] });
    expect(g.maxProb).toBe(42);
    expect(g.values[idx(50, 60)]).toBe(0); // untouched cell
  });

  it("skips malformed / out-of-range points instead of throwing", () => {
    const g = parseOvation({
      coordinates: [
        [0, 60, 9],
        [999, 60, 50], // lng off the lattice → dropped
        [0, 60], // too short → dropped
        "nope", // not an array → dropped
        [1, 60, -4], // negative prob clamps to 0
      ],
    });
    expect(g.values[idx(0, 60)]).toBe(9);
    expect(g.values[idx(1, 60)]).toBe(0);
    expect(g.maxProb).toBe(9);
  });

  it("tolerates junk input without throwing", () => {
    expect(parseOvation(null).maxProb).toBe(0);
    expect(parseOvation({}).values.length).toBe(AURORA_GRID_W * AURORA_GRID_H);
    expect(parseOvation({ coordinates: "bad" }).maxProb).toBe(0);
  });
});

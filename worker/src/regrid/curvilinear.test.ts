import {
  wrapLon,
  targetIndex,
  regridCurvilinear,
  fillPinholes,
  isDefined,
  type RegularGridSpec,
} from "./curvilinear";

const U = 9.999e20;

describe("wrapLon", () => {
  it("normalises into [-180,180)", () => {
    expect(wrapLon(0)).toBe(0);
    expect(wrapLon(200)).toBe(-160);
    expect(wrapLon(360)).toBe(0);
    expect(wrapLon(-190)).toBe(170);
    expect(wrapLon(180)).toBe(-180);
  });
});

describe("targetIndex", () => {
  // 4x2 grid over the globe: dLon=90, dLat=90. row0=north.
  const grid: RegularGridSpec = { width: 4, height: 2, bounds: [-180, -90, 180, 90] };

  it("maps NW corner to row 0 col 0", () => {
    expect(targetIndex(-180, 90, grid)).toBe(0);
  });
  it("maps a mid-grid point to the right cell", () => {
    // lon 0 → col 2; lat 0 → row 1 (southern half). idx = 1*4+2 = 6.
    expect(targetIndex(0, 0, grid)).toBe(6);
  });
  it("wraps 0..360 longitudes", () => {
    // lon 270 → -90 → col 1.
    expect(targetIndex(270, 45, grid)).toBe(1);
  });
  it("rejects out-of-range latitudes", () => {
    expect(targetIndex(0, 95, grid)).toBe(-1);
  });
});

describe("regridCurvilinear", () => {
  const grid: RegularGridSpec = { width: 4, height: 2, bounds: [-180, -90, 180, 90] };

  it("scatters source cells into their target cell, nodata elsewhere", () => {
    const src = {
      values: Float32Array.from([10, 20]),
      lon: Float32Array.from([-180, 0]),
      lat: Float32Array.from([90, 0]),
    };
    const out = regridCurvilinear(src, grid);
    expect(out[0]).toBe(10); // NW corner
    expect(out[6]).toBe(20); // lon0/lat0
    expect(isDefined(out[1])).toBe(false); // uncovered → nodata
  });

  it("skips undefined source cells (land)", () => {
    const src = {
      values: Float32Array.from([U, 5]),
      lon: Float32Array.from([-180, 0]),
      lat: Float32Array.from([90, 0]),
    };
    const out = regridCurvilinear(src, grid);
    expect(isDefined(out[0])).toBe(false);
    expect(out[6]).toBe(5);
  });
});

describe("fillPinholes", () => {
  it("fills a single hole surrounded by data, leaves large gaps", () => {
    // 3x3, centre is a hole with 4 defined neighbours.
    const v = Float32Array.from([U, 2, U, 4, U, 6, U, 8, U]);
    const out = fillPinholes(v, 3, 3);
    expect(out[4]).toBeCloseTo((2 + 4 + 6 + 8) / 4, 5); // centre filled
    expect(isDefined(out[0])).toBe(false); // corner (only 2 nbrs) stays nodata
  });
});

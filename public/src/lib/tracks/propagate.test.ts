import { propagateOne, propagateAll } from "./propagate";
import type { TleRecord } from "./types";

// Real ISS element set; epoch is day 001.5 of 2024 (2024-01-01T12:00Z).
const ISS: TleRecord = {
  name: "ISS (ZARYA)",
  noradId: "25544",
  line1: "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005",
  line2: "2 25544  51.6400 208.9163 0006317  69.9862 290.1234 15.49560000    05",
};

const AT_EPOCH = new Date("2024-01-01T12:00:00Z");

describe("propagateOne (SGP4)", () => {
  const p = propagateOne(ISS, AT_EPOCH)!;

  it("returns a finite geodetic position", () => {
    expect(p).not.toBeNull();
    expect(p.lat).toBeGreaterThanOrEqual(-90);
    expect(p.lat).toBeLessThanOrEqual(90);
    expect(p.lng).toBeGreaterThanOrEqual(-180);
    expect(p.lng).toBeLessThanOrEqual(180);
  });

  it("puts the ISS in low-earth orbit at orbital speed", () => {
    expect(p.altKm).toBeGreaterThan(300);
    expect(p.altKm).toBeLessThan(600);
    expect(p.speedKmS).toBeGreaterThan(6);
    expect(p.speedKmS).toBeLessThan(9);
  });

  it("stays within the orbital inclination band", () => {
    expect(Math.abs(p.lat)).toBeLessThanOrEqual(51.64 + 1);
  });

  it("returns null for garbage elements", () => {
    expect(propagateOne({ ...ISS, line1: "garbage", line2: "garbage" }, AT_EPOCH)).toBeNull();
  });
});

describe("propagateAll", () => {
  it("propagates many and drops failures", () => {
    const bad: TleRecord = { name: "BAD", noradId: "0", line1: "x", line2: "y" };
    expect(propagateAll([ISS, bad], AT_EPOCH)).toHaveLength(1);
  });
});

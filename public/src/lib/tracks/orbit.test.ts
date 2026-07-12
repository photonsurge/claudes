import { satelliteOrbit, orbitSegments } from "./orbit";
import type { TleRecord } from "./types";

// Real ISS element set; epoch is day 001.5 of 2024 (2024-01-01T12:00Z).
const ISS: TleRecord = {
  name: "ISS (ZARYA)",
  noradId: "25544",
  line1: "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005",
  line2: "2 25544  51.6400 208.9163 0006317  69.9862 290.1234 15.49560000    05",
};

const NOW = new Date("2024-01-01T12:00:00Z");

describe("satelliteOrbit", () => {
  const segs = satelliteOrbit(ISS, NOW);

  it("emits path segments for a valid element set", () => {
    expect(segs.length).toBeGreaterThan(0);
  });

  it("labels every segment with the satellite's NORAD id", () => {
    for (const s of segs) expect(s.id.startsWith("25544:")).toBe(true);
  });

  it("never emits a single-point segment (a line needs >1 point)", () => {
    for (const s of segs) expect(s.path.length).toBeGreaterThan(1);
  });

  it("emits finite [lng, lat, altMeters] points at true LEO altitude", () => {
    const pts = segs.flatMap((s) => s.path);
    expect(pts.length).toBeGreaterThan(1);
    for (const [lng, lat, alt] of pts) {
      expect(Number.isFinite(lng)).toBe(true);
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
      // ISS inclination is 51.64° — the ground track stays within that band.
      expect(Math.abs(lat)).toBeLessThanOrEqual(51.64 + 1);
      // Altitude is metres (height km × 1000): ISS orbits at ~400 km ⇒ ~4e5 m.
      expect(alt).toBeGreaterThan(300_000);
      expect(alt).toBeLessThan(600_000);
    }
  });

  it("splits the path at the antimeridian (no |Δlng| > 180 within a segment)", () => {
    for (const s of segs) {
      for (let i = 1; i < s.path.length; i++) {
        expect(Math.abs(s.path[i][0] - s.path[i - 1][0])).toBeLessThanOrEqual(180);
      }
    }
  });

  it("is deterministic for a fixed instant", () => {
    expect(satelliteOrbit(ISS, NOW)).toEqual(segs);
  });

  it("returns [] for garbage elements", () => {
    expect(satelliteOrbit({ ...ISS, line1: "garbage", line2: "garbage" }, NOW)).toEqual([]);
  });
});

describe("orbitSegments", () => {
  it("caps how many satellites it propagates", () => {
    const tles = [
      { ...ISS, noradId: "AAA" },
      { ...ISS, noradId: "BBB" },
      { ...ISS, noradId: "CCC" },
    ];
    const out = orbitSegments(tles, NOW, 2);
    const sats = new Set(out.map((s) => s.id.split(":")[0]));
    expect(sats).toEqual(new Set(["AAA", "BBB"])); // CCC dropped by the cap
  });

  it("returns [] when given no elements", () => {
    expect(orbitSegments([], NOW)).toEqual([]);
  });
});

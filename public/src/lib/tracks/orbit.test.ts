import { satelliteOrbit, orbitSegments, maxOrbitAltitude } from "./orbit";
import { propagateOne } from "./propagate";
import type { TleRecord } from "./types";

// Real ISS element set; epoch is day 001.5 of 2024 (2024-01-01T12:00Z).
const ISS: TleRecord = {
  name: "ISS (ZARYA)",
  noradId: "25544",
  line1: "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005",
  line2: "2 25544  51.6400 208.9163 0006317  69.9862 290.1234 15.49560000    05",
};

/**
 * A geostationary element set (synthetic, but geostationary to four decimals: one
 * revolution per sidereal day, no inclination, no eccentricity). This is the case
 * that used to draw NOTHING — the ring was built as a ground track, and a
 * satellite that hangs over one spot has no ground track to speak of.
 */
const GEO: TleRecord = {
  name: "GEOSAT (SYNTHETIC)",
  noradId: "40874",
  line1: "1 40874U 20001A   24001.50000000  .00000000  00000-0  00000-0 0  9990",
  line2: "2 40874   0.0300 120.0000 0000200  60.0000   0.0000  1.00270000    10",
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

describe("satelliteOrbit at high altitude", () => {
  const segs = satelliteOrbit(GEO, NOW);
  const pts = segs.flatMap((s) => s.path);

  it("draws a geostationary orbit as a full ring, not the point it hangs over", () => {
    const lngs = pts.map((p) => p[0]);
    // The whole belt: a ring that circles the planet, split at the antimeridian.
    expect(Math.min(...lngs)).toBeLessThan(-179);
    expect(Math.max(...lngs)).toBeGreaterThan(179);
    expect(segs.length).toBe(2);
  });

  it("holds the ring at geostationary altitude all the way round", () => {
    for (const [, , alt] of pts) {
      expect(alt).toBeGreaterThan(35_500_000);
      expect(alt).toBeLessThan(36_000_000);
    }
  });

  it("stays on the equator, as a zero-inclination orbit does", () => {
    for (const [, lat] of pts) expect(Math.abs(lat)).toBeLessThan(1);
  });

  it("closes the antimeridian seam exactly on ±180, so the ring has no gap", () => {
    const ends = segs.map((s) => s.path[s.path.length - 1][0]);
    const starts = segs.map((s) => s.path[0][0]);
    const seam = [...ends, ...starts].filter((lng) => Math.abs(Math.abs(lng) - 180) < 1e-9);
    expect(seam.length).toBeGreaterThanOrEqual(2);
  });
});

describe("rings and markers agree", () => {
  it.each([
    ["ISS", ISS],
    ["geostationary", GEO],
  ])("starts the %s ring on the satellite's live position", (_label, tle) => {
    const first = satelliteOrbit(tle, NOW)[0].path[0];
    const live = propagateOne(tle, NOW);
    expect(live).not.toBeNull();
    // Same instant, same Earth rotation: the marker sits ON its own ring.
    expect(first[0]).toBeCloseTo((live as NonNullable<typeof live>).lng, 6);
    expect(first[1]).toBeCloseTo((live as NonNullable<typeof live>).lat, 6);
    expect(first[2]).toBeCloseTo((live as NonNullable<typeof live>).altKm * 1000, 3);
  });
});

describe("maxOrbitAltitude", () => {
  it("reports the highest ring, which is what sizes the globe's far clip plane", () => {
    const low = maxOrbitAltitude(satelliteOrbit(ISS, NOW));
    const high = maxOrbitAltitude(satelliteOrbit(GEO, NOW));
    expect(low).toBeGreaterThan(300_000);
    expect(low).toBeLessThan(600_000);
    expect(high).toBeGreaterThan(35_500_000);
  });

  it("is 0 when there is nothing to draw", () => {
    expect(maxOrbitAltitude([])).toBe(0);
  });
});

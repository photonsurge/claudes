import { parseAdsb, bboxToPointRadius } from "./adsb";

describe("parseAdsb", () => {
  const json = {
    ac: [
      { hex: "4007a5", flight: "BAW123  ", lat: 51.5, lon: -0.45, alt_geom: 36000, gs: 450, track: 95 },
      { hex: "abc999", flight: "GND1", lat: 51.4, lon: -0.4, alt_baro: "ground", gs: 0, track: 0 },
      { hex: "noPos", flight: "X" }, // dropped — no position
    ],
  };
  const rows = parseAdsb(json);

  it("keeps positioned aircraft and converts ft→m, kt→m/s", () => {
    expect(rows).toHaveLength(2);
    const a = rows[0];
    expect(a.icao24).toBe("4007a5");
    expect(a.callsign).toBe("BAW123");
    expect(a.altM).toBeCloseTo(36000 * 0.3048, 1);
    expect(a.velocityMS).toBeCloseTo(450 * 0.514444, 1);
    expect(a.headingDeg).toBe(95);
    expect(a.onGround).toBe(false);
  });

  it("treats alt_baro 'ground' as on-ground at 0 m", () => {
    const g = rows.find((r) => r.icao24 === "abc999")!;
    expect(g.onGround).toBe(true);
    expect(g.altM).toBe(0);
  });

  it("returns [] for malformed input", () => {
    expect(parseAdsb(null)).toEqual([]);
    expect(parseAdsb({})).toEqual([]);
  });
});

describe("bboxToPointRadius", () => {
  it("derives centre and a clamped radius from a bbox", () => {
    const { lat, lon, distNm } = bboxToPointRadius([-1, 50, 1, 52]);
    expect(lat).toBe(51);
    expect(lon).toBe(0);
    expect(distNm).toBeGreaterThan(0);
    expect(distNm).toBeLessThanOrEqual(250);
  });
});

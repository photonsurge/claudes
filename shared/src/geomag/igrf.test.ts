import {
  parseIgrfDipole,
  dipoleForYear,
  dipoleTotalIntensity,
  IGRF14_DIPOLE_2025,
} from "./igrf";

const dip = (lat: number, lon: number, year = 2025.0) =>
  dipoleTotalIntensity(lat, lon, dipoleForYear(IGRF14_DIPOLE_2025, year));

describe("parseIgrfDipole", () => {
  it("reads the degree-1 2025.0 values + secular variation from the file rows", () => {
    const txt = [
      "# comment",
      "g/h n m 1900 ... 2020 2025 SV",
      "g  1  0 -31543  -29619.4 -29554.63 -29496.57 -29441.46 -29403.41 -29350.0    12.6",
      "g  1  1  -2298   -1728.2  -1669.05  -1586.42  -1501.77  -1451.37  -1410.3    10.0",
      "h  1  1   5922    5186.1   5077.99   4944.26   4795.99   4653.35   4545.5   -21.5",
      "g  2  0 -2000     -100      -90       -80       -70       -60       -50      1.0",
    ].join("\n");
    const c = parseIgrfDipole(txt);
    expect(c.g10).toBe(-29350.0);
    expect(c.g11).toBe(-1410.3);
    expect(c.h11).toBe(4545.5);
    expect(c.g10sv).toBe(12.6);
    expect(c.h11sv).toBe(-21.5);
  });

  it("falls back to the embedded set when degree-1 rows are missing", () => {
    expect(parseIgrfDipole("garbage\n")).toEqual(IGRF14_DIPOLE_2025);
  });
});

describe("dipoleForYear", () => {
  it("extrapolates via secular variation", () => {
    const g = dipoleForYear(IGRF14_DIPOLE_2025, 2027.0);
    expect(g.g10).toBeCloseTo(-29350.0 + 12.6 * 2, 3);
    expect(g.h11).toBeCloseTo(4545.5 - 21.5 * 2, 3);
  });
});

describe("dipoleTotalIntensity", () => {
  // The dipole field is weak (~30k nT) near the geomagnetic equator and strong
  // (~60k nT) toward the poles — the defining equator-to-pole range of a real
  // magnetic-intensity map. These check magnitudes against known physics.
  it("is ~30,000 nT near the geographic equator", () => {
    const f = dip(0, 0);
    expect(f).toBeGreaterThan(26000);
    expect(f).toBeLessThan(34000);
  });

  it("is ~2x stronger toward the poles than the equator", () => {
    const pole = dip(90, 0);
    const eq = dip(0, 0);
    expect(pole).toBeGreaterThan(55000);
    expect(pole).toBeLessThan(63000);
    expect(pole / eq).toBeGreaterThan(1.7);
  });

  it("stays within the physical global range everywhere", () => {
    let min = Infinity, max = -Infinity;
    for (let lat = -90; lat <= 90; lat += 10) {
      for (let lon = -180; lon < 180; lon += 10) {
        const f = dip(lat, lon);
        min = Math.min(min, f);
        max = Math.max(max, f);
      }
    }
    expect(min).toBeGreaterThan(22000);
    expect(max).toBeLessThan(66000);
  });

  it("secular variation shifts the field a little year-to-year", () => {
    expect(dip(0, 0, 2030) - dip(0, 0, 2020)).not.toBeCloseTo(0, 1);
  });
});

import {
  computeCountryTour,
  COUNTRY_TOUR_MAX_STOPS,
  type TourCityInput,
} from "./director-country-tour";

const city = (name: string, lng: number, lat: number, population: number): TourCityInput => ({
  name,
  cc: "xx",
  lng,
  lat,
  population,
});

describe("computeCountryTour", () => {
  it("returns null when there are no usable cities", () => {
    expect(computeCountryTour([])).toBeNull();
    expect(computeCountryTour([{ name: "Bad", lng: NaN, lat: 10 }])).toBeNull();
  });

  it("spreads waypoints across compass sectors instead of clustering", () => {
    // A ring of equal-size cities around a centre — one per cardinal direction,
    // plus a cluster of small ones in the east that must NOT crowd out the others.
    const cities = [
      city("North", 0, 10, 500_000),
      city("East", 10, 0, 500_000),
      city("South", 0, -10, 500_000),
      city("West", -10, 0, 500_000),
      city("EastSmall1", 9, 1, 120_000),
      city("EastSmall2", 11, -1, 120_000),
    ];
    const tour = computeCountryTour(cities)!;
    expect(tour).not.toBeNull();
    const names = tour.cities.map((c) => c.name);
    // Every cardinal city is represented; the little eastern ones lose their
    // sector to the big "East".
    expect(names).toEqual(expect.arrayContaining(["North", "East", "South", "West"]));
    expect(names).not.toContain("EastSmall1");
    // Each picked city carries a sector tag, and no sector repeats.
    const sectors = tour.cities.map((c) => c.sector);
    expect(new Set(sectors).size).toBe(sectors.length);
  });

  it("picks the biggest city per sector, not the most extreme", () => {
    const tour = computeCountryTour([
      city("Capital", 0.5, 0.5, 5_000_000), // near centre, dominant
      city("BigNorth", 1, 8, 2_000_000),
      city("TinyFarNorth", 0, 20, 3_000), // most northerly but negligible
    ])!;
    const north = tour.cities.find((c) => c.name === "TinyFarNorth");
    expect(north).toBeUndefined(); // the extreme hamlet is never chosen
    expect(tour.cities.map((c) => c.name)).toContain("BigNorth");
    expect(tour.cities.map((c) => c.name)).toContain("Capital");
  });

  it("always includes the #1 city and caps the number of stops", () => {
    // 20 cities scattered around; the largest must survive the cap.
    const cities: TourCityInput[] = [];
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * 2 * Math.PI;
      cities.push(city(`c${i}`, Math.cos(ang) * 10, Math.sin(ang) * 10, 100_000 + i * 1000));
    }
    const biggest = cities[cities.length - 1];
    const tour = computeCountryTour(cities)!;
    expect(tour.cities.length).toBeLessThanOrEqual(COUNTRY_TOUR_MAX_STOPS);
    expect(tour.cities.map((c) => c.name)).toContain(biggest.name);
  });

  it("puts the population-weighted centroid where the people are", () => {
    // One huge western city + a few small eastern ones ⇒ centroid pulled west.
    const tour = computeCountryTour([
      city("Metropolis", -20, 0, 10_000_000),
      city("Small1", 20, 2, 50_000),
      city("Small2", 22, -2, 50_000),
    ])!;
    expect(tour.centroid[0]).toBeLessThan(-10);
  });

  it("handles an antimeridian country without blowing the centroid across the seam", () => {
    // Cities straddling ±180 (like Fiji): raw averaging would land near 0°E.
    const tour = computeCountryTour([
      city("West", 177, -17, 200_000),
      city("East", -179, -18, 180_000),
      city("Mid", 179, -17.5, 150_000),
    ])!;
    // The true centre is ~179°, NOT ~0° — assert we didn't average across the seam.
    expect(Math.abs(tour.centroid[0])).toBeGreaterThan(170);
    // All coordinates come back in valid range.
    for (const c of tour.cities) {
      expect(c.lng).toBeGreaterThanOrEqual(-180);
      expect(c.lng).toBeLessThanOrEqual(180);
    }
    expect(tour.frame.center[0]).toBeGreaterThanOrEqual(-180);
    expect(tour.frame.center[0]).toBeLessThanOrEqual(180);
  });

  it("frames a sensible broadcast zoom", () => {
    const tour = computeCountryTour([
      city("A", -5, 45, 500_000),
      city("B", 5, 50, 400_000),
      city("C", 0, 42, 300_000),
    ])!;
    expect(tour.frame.zoom).toBeGreaterThan(1);
    expect(tour.frame.zoom).toBeLessThanOrEqual(5);
  });
});

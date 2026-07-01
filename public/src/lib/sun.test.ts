import { subsolarPoint, cosSunZenith, nightAlpha } from "./sun";

describe("subsolarPoint", () => {
  it("puts the sun near the equator at an equinox", () => {
    // ~2024 March equinox.
    const [, lat] = subsolarPoint(new Date("2024-03-20T03:06:00Z"));
    expect(Math.abs(lat)).toBeLessThan(1.5);
  });

  it("puts the sun near the Tropic of Cancer at the June solstice", () => {
    const [, lat] = subsolarPoint(new Date("2024-06-20T20:51:00Z"));
    expect(lat).toBeGreaterThan(22);
    expect(lat).toBeLessThan(24);
  });

  it("puts the sun near the Tropic of Capricorn at the December solstice", () => {
    const [, lat] = subsolarPoint(new Date("2024-12-21T09:20:00Z"));
    expect(lat).toBeLessThan(-22);
    expect(lat).toBeGreaterThan(-24);
  });

  it("places the subsolar longitude near the anti-noon meridian at UTC noon", () => {
    // At UTC noon the sun is roughly over the prime meridian (±eqtime).
    const [lng] = subsolarPoint(new Date("2024-03-20T12:00:00Z"));
    expect(Math.abs(lng)).toBeLessThan(5);
  });

  it("moves the subsolar longitude ~180° west by UTC midnight", () => {
    const [lng] = subsolarPoint(new Date("2024-03-20T00:00:00Z"));
    expect(Math.abs(Math.abs(lng) - 180)).toBeLessThan(5);
  });
});

describe("cosSunZenith", () => {
  const sub: [number, number] = [0, 0]; // sun over 0,0

  it("is +1 at the subsolar point", () => {
    expect(cosSunZenith(0, 0, sub)).toBeCloseTo(1, 5);
  });

  it("is ~0 at 90° away (the terminator)", () => {
    expect(cosSunZenith(90, 0, sub)).toBeCloseTo(0, 5);
  });

  it("is -1 at the antipode (deep night)", () => {
    expect(cosSunZenith(180, 0, sub)).toBeCloseTo(-1, 5);
  });
});

describe("nightAlpha", () => {
  it("is 0 in full daylight", () => {
    expect(nightAlpha(1)).toBe(0);
  });

  it("is 1 in deep night", () => {
    expect(nightAlpha(-1)).toBe(1);
  });

  it("rises monotonically as the sun sinks", () => {
    expect(nightAlpha(0.05)).toBeGreaterThanOrEqual(nightAlpha(0.09));
    expect(nightAlpha(-0.1)).toBeGreaterThan(nightAlpha(0.05));
  });

  it("is roughly half-dark at the terminator", () => {
    const a = nightAlpha(-0.04); // near the midpoint of the twilight band
    expect(a).toBeGreaterThan(0.3);
    expect(a).toBeLessThan(0.7);
  });
});

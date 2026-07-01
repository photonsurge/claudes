import { validateCity, cityLabelMinZoom, formatPopulation, cityDetail } from "./cities";

describe("cityLabelMinZoom", () => {
  it("shows capitals and mega-cities on the whole-globe view", () => {
    expect(cityLabelMinZoom({ isCapital: true })).toBe(0);
    expect(cityLabelMinZoom({ population: 8_000_000, isCapital: false })).toBe(0);
  });

  it("reveals smaller cities only at higher zoom", () => {
    const big = cityLabelMinZoom({ population: 1_500_000 });
    const small = cityLabelMinZoom({ population: 60_000 });
    expect(small).toBeGreaterThan(big);
  });

  it("gives unknown-population cities a mid threshold", () => {
    const z = cityLabelMinZoom({});
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(cityLabelMinZoom({ population: 10_000 }));
  });
});

describe("formatPopulation", () => {
  it("formats millions and thousands compactly", () => {
    expect(formatPopulation(9_000_000)).toBe("9.0M");
    expect(formatPopulation(12_000_000)).toBe("12M");
    expect(formatPopulation(540_000)).toBe("540k");
    expect(formatPopulation(800)).toBe("800");
  });

  it("returns undefined for missing/zero population", () => {
    expect(formatPopulation(undefined)).toBeUndefined();
    expect(formatPopulation(0)).toBeUndefined();
  });
});

describe("cityDetail", () => {
  it("joins country, population and capital flag", () => {
    expect(cityDetail({ country: "France", population: 2_100_000, isCapital: true })).toBe(
      "France · 2.1M · capital",
    );
  });

  it("is undefined when there is nothing to show", () => {
    expect(cityDetail({})).toBeUndefined();
  });
});

describe("validateCity", () => {
  it("accepts a valid city and coerces numeric fields", () => {
    const r = validateCity({
      name: "  London ",
      country: "GB",
      lat: "51.5",
      lng: "-0.12",
      population: "9000000",
      isCapital: true,
    });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      name: "London",
      country: "GB",
      lat: 51.5,
      lng: -0.12,
      population: 9000000,
      isCapital: true,
    });
  });

  it("requires a name", () => {
    const r = validateCity({ name: "  ", lat: 1, lng: 2 });
    expect(r.ok).toBe(false);
    expect(r.errors.name).toBeDefined();
  });

  it("validates lat/lng ranges", () => {
    expect(validateCity({ name: "x", lat: 100, lng: 0 }).errors.lat).toBeDefined();
    expect(validateCity({ name: "x", lat: 0, lng: 200 }).errors.lng).toBeDefined();
  });

  it("requires lat/lng to be present and numeric", () => {
    const r = validateCity({ name: "x", lat: "", lng: "abc" });
    expect(r.errors.lat).toBeDefined();
    expect(r.errors.lng).toBeDefined();
  });

  it("treats population as optional, rejects negatives", () => {
    expect(validateCity({ name: "x", lat: 0, lng: 0 }).ok).toBe(true);
    expect(validateCity({ name: "x", lat: 0, lng: 0, population: -5 }).errors.population).toBeDefined();
  });

  it("defaults isCapital to false and drops empty country", () => {
    const r = validateCity({ name: "x", lat: 0, lng: 0, country: "  " });
    expect(r.value?.isCapital).toBe(false);
    expect(r.value?.country).toBeUndefined();
  });
});

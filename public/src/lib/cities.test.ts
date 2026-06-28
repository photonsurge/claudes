import { validateCity } from "./cities";

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

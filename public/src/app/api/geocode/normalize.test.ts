import { normalizeGeocode, type NominatimHit } from "./normalize";

describe("normalizeGeocode", () => {
  it("emits [lng,lat] center and [w,s,e,n] bbox from Nominatim order", () => {
    // Nominatim boundingbox order is [south, north, west, east].
    const hit: NominatimHit = {
      lat: "51.5",
      lon: "-0.12",
      boundingbox: ["51.2", "51.7", "-0.5", "0.3"],
      display_name: "London, UK",
    };
    const r = normalizeGeocode(hit)!;
    expect(r.center).toEqual([-0.12, 51.5]);
    expect(r.bbox).toEqual([-0.5, 51.2, 0.3, 51.7]);
    expect(r.label).toBe("London, UK");
  });

  it("synthesises a small bbox when none is provided", () => {
    const r = normalizeGeocode({ lat: "10", lon: "20" })!;
    expect(r.center).toEqual([20, 10]);
    expect(r.bbox).toEqual([19.9, 9.9, 20.1, 10.1]);
  });

  it("returns null for missing/invalid hits", () => {
    expect(normalizeGeocode(null)).toBeNull();
    expect(normalizeGeocode(undefined)).toBeNull();
    expect(normalizeGeocode({ lat: "x", lon: "y" })).toBeNull();
  });
});

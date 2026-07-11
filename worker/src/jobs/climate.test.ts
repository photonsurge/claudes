/**
 * framedCityPoints — the climate job caches the on-air frame's own cities (a
 * superset of what TopCitiesPanel / the nearby-cities panel spark) so their
 * per-city /climate requests stop 404-ing. Guards the zoom gate, the
 * antimeridian window, and fail-open behaviour.
 */
import { framedCityPoints, cityClimatePoints } from "./climate";

// Only db.cities.getAll is exercised by framedCityPoints.
function mockDb(getAll: jest.Mock) {
  return { cities: { getAll } } as unknown as Parameters<typeof framedCityPoints>[0];
}

describe("framedCityPoints", () => {
  it("returns [] for a wide/global shot (below spotlight zoom) without querying", async () => {
    const getAll = jest.fn();
    const pts = await framedCityPoints(mockDb(getAll), [0, 20], 1.4);
    expect(pts).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });

  it("returns the framed cities' [lng,lat], population-sorted + limited", async () => {
    const getAll = jest.fn().mockResolvedValue({
      data: [
        { lng: 139.7, lat: 35.7, population: 9_000_000 },
        { lng: 135.5, lat: 34.7, population: 2_700_000 },
      ],
    });
    const pts = await framedCityPoints(mockDb(getAll), [138, 36], 5);
    expect(pts).toEqual([
      [139.7, 35.7],
      [135.5, 34.7],
    ]);
    const [query, opts] = getAll.mock.calls[0];
    expect(query.loc).toBeDefined(); // 2dsphere box on `loc` (antimeridian-safe)
    expect(opts.sort).toEqual({ population: -1 });
    expect(typeof opts.limit).toBe("number");
  });

  it("queries a 2dsphere `loc` box near the antimeridian (no flat-lng special case)", async () => {
    const getAll = jest.fn().mockResolvedValue({ data: [] });
    await framedCityPoints(mockDb(getAll), [179, 0], 5);
    const [query] = getAll.mock.calls[0];
    expect(query.loc).toBeDefined(); // seam handled inside cityGeoWithinBox
    expect(query.lng).toBeUndefined();
  });

  it("skips rows with non-numeric coords", async () => {
    const getAll = jest.fn().mockResolvedValue({
      data: [{ lng: 10, lat: 50 }, { lng: null, lat: 50 }, { name: "x" }],
    });
    const pts = await framedCityPoints(mockDb(getAll), [10, 50], 5);
    expect(pts).toEqual([[10, 50]]);
  });

  it("is fail-open: a query error yields [] and never throws", async () => {
    const getAll = jest.fn().mockRejectedValue(new Error("mongo down"));
    await expect(framedCityPoints(mockDb(getAll), [0, 40], 5)).resolves.toEqual([]);
  });
});

describe("cityClimatePoints", () => {
  it("dedups cities sharing a 0.1° key, keeping the first (biggest) seen", () => {
    // Two London points round to the same 0.1° key; the biggest-first input keeps
    // the first. A distinct city keeps its own key.
    const pts = cityClimatePoints([
      { lat: 51.5074, lng: -0.1278 }, // London → 51.5,-0.1
      { lat: 51.52, lng: -0.09 }, //     also 51.5,-0.1 — dropped
      { lat: 52.48, lng: -1.9 }, //      Birmingham → 52.5,-1.9
    ]);
    expect(pts).toEqual([
      { key: "51.5,-0.1", lat: 51.5074, lng: -0.1278 },
      { key: "52.5,-1.9", lat: 52.48, lng: -1.9 },
    ]);
  });

  it("skips rows with non-numeric / non-finite coords", () => {
    const pts = cityClimatePoints([
      { lat: 50, lng: 10 },
      { lat: null as any, lng: 10 },
      { lat: NaN, lng: 10 },
      { lat: 40, lng: "x" as any },
    ]);
    expect(pts).toEqual([{ key: "50.0,10.0", lat: 50, lng: 10 }]);
  });

  it("returns [] for an empty list", () => {
    expect(cityClimatePoints([])).toEqual([]);
  });
});

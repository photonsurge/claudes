/**
 * framedCityPoints — the climate job caches the on-air frame's own cities (a
 * superset of what TopCitiesPanel / the nearby-cities panel spark) so their
 * per-city /climate requests stop 404-ing. Guards the zoom gate, the
 * antimeridian window, and fail-open behaviour.
 */
import { framedCityPoints } from "./climate";

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
    expect(query.lat).toBeDefined();
    expect(query.lng).toBeDefined(); // simple (non-wrapping) window
    expect(opts.sort).toEqual({ population: -1 });
    expect(typeof opts.limit).toBe("number");
  });

  it("uses an $or window across the antimeridian", async () => {
    const getAll = jest.fn().mockResolvedValue({ data: [] });
    await framedCityPoints(mockDb(getAll), [179, 0], 5);
    const [query] = getAll.mock.calls[0];
    expect(query.$or).toBeDefined();
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

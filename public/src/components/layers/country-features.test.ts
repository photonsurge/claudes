import {
  countryBorderRings,
  loadCountryFeatureList,
  loadCountryFeatures,
  resetCountryFeaturesForTests,
} from "./country-features";

const SQUARE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];
const features = [
  { type: "Feature", properties: { iso_a2: "pt" }, geometry: { type: "Polygon", coordinates: [SQUARE] } },
  { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [[SQUARE], [SQUARE]] } },
];

function mockFetch(body: unknown, ok = true) {
  const fn = jest.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body }));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => resetCountryFeaturesForTests());
afterEach(() => {
  // @ts-expect-error — restore the jsdom default (no fetch)
  delete global.fetch;
});

describe("country-features", () => {
  it("fetches and parses the file ONCE for the list, the ISO index and the border rings", async () => {
    const fetchFn = mockFetch({ features });
    const [list, index, rings] = await Promise.all([
      loadCountryFeatureList(),
      loadCountryFeatures(),
      countryBorderRings(),
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(list).toBe(features);
    expect([...index.keys()]).toEqual(["PT"]); // no iso_a2 → not indexed
    expect(rings.map((r) => r.path)).toEqual([SQUARE, SQUARE, SQUARE]);
    expect(rings[0].feature).toBe(features[0]);
  });

  it("hands deck the SAME promise every time (a fresh one per rebuild would refetch + re-tessellate)", () => {
    mockFetch({ features });
    expect(countryBorderRings()).toBe(countryBorderRings());
    expect(loadCountryFeatures()).toBe(loadCountryFeatures());
  });

  it("degrades to nothing on a failed fetch, with a warning, rather than throwing into deck", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch({}, false);
    expect(await countryBorderRings()).toEqual([]);
    expect(await loadCountryFeatures()).toEqual(new Map());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/HTTP 500/);
    warn.mockRestore();
  });

  it("is silently empty where there is no fetch at all (tests / SSR)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(await countryBorderRings()).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

import { fetchCountryFeatures } from "./meteogate";

/**
 * The page walk, proven without touching the live API.
 *
 * This is the logic that silently broke the whole cache: the EDR feed is sorted
 * OLDEST-FIRST, so a front-loaded page cap re-reads ancient alerts forever and
 * never sees a new EMMA area. These lock the direction in.
 */

const page = (p: number, totalPages: number, ids: string[]) => ({
  type: "FeatureCollection",
  metadata: { page: p, total_pages: totalPages, page_size: 100 },
  features: ids.map((id) => ({
    id,
    geometry: null,
    properties: { alertId: id, countryCode: "PL", indexInfo: 0, indexArea: 0 },
    links: [],
  })),
});

const res = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: {
    get: (k: string) =>
      k === "x-ratelimit-remaining" ? "500" : k === "x-ratelimit-reset" ? "3600" : null,
  },
  text: async () => JSON.stringify(body),
});

/** Serve a 7-page country and record which pages were asked for, in order. */
function mockFeed(totalPages = 7) {
  const asked: number[] = [];
  global.fetch = jest.fn(async (url: string) => {
    const p = Number(new URL(String(url)).searchParams.get("page") ?? 1);
    asked.push(p);
    return res(page(p, totalPages, [`alert-p${p}`])) as never;
  }) as never;
  return asked;
}

describe("fetchCountryFeatures — page direction", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  it("reads the NEWEST pages, not the oldest", async () => {
    process.env.METEOGATE_MAX_PAGES = "3";
    const asked = mockFeed(7);

    await fetchCountryFeatures("PL");

    // Page 1 only to learn the count; then backwards from the last page, where
    // newly issued alerts land. Reading 1,2,3 would return alerts the ledger
    // resolved yesterday and the cache would never grow.
    expect(asked).toEqual([1, 7, 6]);
  });

  it("returns the features from those newest pages", async () => {
    process.env.METEOGATE_MAX_PAGES = "3";
    mockFeed(7);

    const feats = await fetchCountryFeatures("PL");

    expect(feats.map((f) => f.alertId).sort()).toEqual(["alert-p1", "alert-p6", "alert-p7"]);
  });

  it("honours the page cap so 39 countries can't eat the hour", async () => {
    process.env.METEOGATE_MAX_PAGES = "2";
    const asked = mockFeed(7);

    await fetchCountryFeatures("PL");

    expect(asked).toEqual([1, 7]);
  });

  it("does not re-read page 1 when a country has only one page", async () => {
    process.env.METEOGATE_MAX_PAGES = "3";
    const asked = mockFeed(1);

    await fetchCountryFeatures("PL");

    expect(asked).toEqual([1]);
  });

  it("handles a two-page country without duplicating a page", async () => {
    process.env.METEOGATE_MAX_PAGES = "5";
    const asked = mockFeed(2);

    await fetchCountryFeatures("PL");

    expect(asked).toEqual([1, 2]);
  });
});

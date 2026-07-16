import { freshPages, fetchPages, windowFor } from "./meteogate";

/**
 * The page walk, proven without touching the live API.
 *
 * History matters here. This file used to cover `fetchCountryFeatures`, which
 * read page 1, the last page and the second-to-last — and nothing else, ever. Its
 * tests passed, and one of them ("honours the page cap so 39 countries can't eat
 * the hour") asserted the bug as a feature. Live, that cap left 492 of Europe's
 * 565 pages (87%) permanently unread and half our warning areas with no boundary;
 * reading all 42 of Austria's pages turned up 7 EMMA_IDs we lack, all on page 2.
 *
 * What was RIGHT and is kept below: the feed is sorted OLDEST-FIRST, so new
 * alerts land at the back and a freshness read must work from the last page
 * backwards. The deep crawl (see geom-sync#planCrawl) now covers the middle.
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

/** Serve a country and record which pages were asked for, and with what window. */
function mockFeed(totalPages = 7) {
  const asked: number[] = [];
  const windows: string[] = [];
  global.fetch = jest.fn(async (url: string) => {
    const u = new URL(String(url));
    asked.push(Number(u.searchParams.get("page") ?? 1));
    windows.push(String(u.searchParams.get("datetime")));
    return res(page(Number(u.searchParams.get("page") ?? 1), totalPages, [
      `alert-p${u.searchParams.get("page")}`,
    ])) as never;
  }) as never;
  return { asked, windows };
}

describe("freshPages — which pages the every-run read covers", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  it("reads the NEWEST pages, not the oldest", () => {
    // Reading 1,2,3 would return alerts the ledger resolved yesterday.
    expect(freshPages(7, 2)).toEqual([1, 6, 7]);
  });

  it("does not duplicate page 1 when a country has only one page", () => {
    // 20 of the 39 countries are single-page.
    expect(freshPages(1, 2)).toEqual([1]);
  });

  it("handles a two-page country without duplicating a page", () => {
    expect(freshPages(2, 5)).toEqual([1, 2]);
  });

  it("no longer decides overall coverage — the crawl reads the rest", () => {
    // The point of the rewrite: this is a FRESHNESS read over a 42-page country,
    // and the 39 pages it doesn't name are the crawl's job, not lost.
    expect(freshPages(42, 2)).toEqual([1, 41, 42]);
  });
});

describe("fetchPages", () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
    jest.restoreAllMocks();
  });

  it("fetches exactly the pages it is given, in order", async () => {
    const { asked } = mockFeed(42);

    await fetchPages("PL", [2, 3, 4], windowFor(new Date()), () => false);

    expect(asked).toEqual([2, 3, 4]);
  });

  it("sends the SAME window on every page", async () => {
    // The crawl's whole correctness rests on this: the feed's default interval
    // moves, so pages renumber between runs unless the query is pinned.
    const { windows } = mockFeed(42);
    const w = { from: new Date("2026-07-10T02:00:00Z"), to: new Date("2026-07-11T01:00:00Z") };

    await fetchPages("PL", [2, 3, 4], w, () => false);

    expect(new Set(windows).size).toBe(1);
    expect(windows[0]).toBe("2026-07-10T02:00:00Z/2026-07-11T01:00:00Z");
  });

  it("stops when told to, and reports only the pages it actually read", async () => {
    // A run that stops on the page budget must not let the cursor claim the
    // pages it never fetched — those boundaries would be skipped until the next
    // full re-crawl.
    const { asked } = mockFeed(42);
    let n = 0;
    const stop = () => n++ >= 2;

    const got = await fetchPages("PL", [2, 3, 4, 5, 6], windowFor(new Date()), stop);

    expect(asked).toEqual([2, 3]);
    expect(got.read).toEqual([2, 3]);
  });

  it("returns the features from the pages it read", async () => {
    mockFeed(42);

    const got = await fetchPages("PL", [2, 3], windowFor(new Date()), () => false);

    expect(got.features.map((f) => f.alertId)).toEqual(["alert-p2", "alert-p3"]);
  });
});

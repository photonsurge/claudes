import { validateCity, cityLabelMinZoom, formatPopulation, cityDetail, getCity, listCitiesPage, queueCitiesEnrichment } from "./cities";

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

describe("queueCitiesEnrichment", () => {
  afterEach(() => jest.restoreAllMocks());

  it("queues the allowlisted city enrichment worker job", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, jobId: "42" }),
    })) as unknown as typeof fetch;

    await expect(queueCitiesEnrichment()).resolves.toEqual({ ok: true, jobId: "42", alreadyQueued: false });
    expect(global.fetch).toHaveBeenCalledWith("/api/admin/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "cities-enrich-all" }),
    });
  });

  it("can queue the smaller prominent-city job separately", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, jobId: "43" }),
    })) as unknown as typeof fetch;

    await queueCitiesEnrichment("prominent");
    expect(global.fetch).toHaveBeenCalledWith("/api/admin/jobs", expect.objectContaining({
      body: JSON.stringify({ id: "cities-enrich" }),
    }));
  });
});

describe("listCitiesPage", () => {
  afterEach(() => jest.restoreAllMocks());

  it("requests the selected page and ordering", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ cities: [], count: 0, total: 60, page: 2, pageSize: 25, pageCount: 3 }),
    })) as unknown as typeof fetch;

    await listCitiesPage({ pageIndex: 1, pageSize: 25, sortBy: "name", sortDirection: "asc", q: "lon" });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/cities?page=2&pageSize=25&sort=name&direction=asc&q=lon",
      { cache: "no-store" },
    );
  });
});

describe("getCity", () => {
  afterEach(() => jest.restoreAllMocks());

  it("loads the full record used by the dedicated city page", async () => {
    const city = { id: "city:paris", name: "Paris", lat: 48.85, lng: 2.35 };
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ city }),
    })) as unknown as typeof fetch;

    await expect(getCity("city:paris")).resolves.toEqual({ city });
    expect(global.fetch).toHaveBeenCalledWith("/api/cities/city%3Aparis", { cache: "no-store" });
  });
});

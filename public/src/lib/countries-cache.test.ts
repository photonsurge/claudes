import { getCachedCountries, clearCountriesCache } from "./countries-cache";

/** Minimal db stub exposing only what getCachedCountries touches, counting reads. */
function fakeDb() {
  let reads = 0;
  const rows = [{ countryId: "GB", name: "United Kingdom", geometry: { type: "Polygon", coordinates: [] } }];
  return {
    reads: () => reads,
    db: { countries: { list: async () => { reads++; return rows; } } } as never,
  };
}

describe("getCachedCountries", () => {
  beforeEach(() => clearCountriesCache());

  it("reads the catalog once and serves the cache thereafter", async () => {
    const { db, reads } = fakeDb();
    const a = await getCachedCountries(db);
    const b = await getCachedCountries(db);
    expect(a).toBe(b); // same array instance — not reloaded
    expect(reads()).toBe(1);
  });

  it("single-flights concurrent cold-cache callers onto one read", async () => {
    const { db, reads } = fakeDb();
    await Promise.all([getCachedCountries(db), getCachedCountries(db), getCachedCountries(db)]);
    expect(reads()).toBe(1);
  });

  it("reloads after the cache is cleared", async () => {
    const { db, reads } = fakeDb();
    await getCachedCountries(db);
    clearCountriesCache();
    await getCachedCountries(db);
    expect(reads()).toBe(2);
  });
});

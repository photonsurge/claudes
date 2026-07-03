import {
  COUNTRY_SHOTS,
  countryShot,
  DEFAULT_DIRECTOR_COUNTRIES,
  sanitizeDirectorCountries,
} from "./director-countries";

describe("COUNTRY_SHOTS catalog", () => {
  it("has unique ids and a flag + framing for every country", () => {
    const ids = COUNTRY_SHOTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of COUNTRY_SHOTS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.flag.length).toBeGreaterThan(0);
      expect(c.center[0]).toBeGreaterThanOrEqual(-180);
      expect(c.center[0]).toBeLessThanOrEqual(180);
      expect(c.center[1]).toBeGreaterThanOrEqual(-90);
      expect(c.center[1]).toBeLessThanOrEqual(90);
      // Country framings sit between the regional tours (~3) and city close-ups.
      expect(c.zoom).toBeGreaterThanOrEqual(3);
      expect(c.zoom).toBeLessThanOrEqual(5.5);
    }
  });

  it("includes the default favourites (UK + Japan)", () => {
    expect(DEFAULT_DIRECTOR_COUNTRIES).toEqual(["uk", "japan"]);
    for (const id of DEFAULT_DIRECTOR_COUNTRIES) {
      expect(countryShot(id)).toBeDefined();
    }
    expect(countryShot("uk")?.name).toBe("United Kingdom");
    expect(countryShot("japan")?.flag).toBe("🇯🇵");
  });

  it("looks up by id and misses unknowns", () => {
    expect(countryShot("nope")).toBeUndefined();
  });
});

describe("sanitizeDirectorCountries", () => {
  it("rejects non-arrays (merge keeps the base)", () => {
    expect(sanitizeDirectorCountries(undefined)).toBeNull();
    expect(sanitizeDirectorCountries("uk")).toBeNull();
    expect(sanitizeDirectorCountries({ uk: true })).toBeNull();
  });

  it("keeps only known ids, deduped, in catalog order", () => {
    expect(sanitizeDirectorCountries(["japan", "atlantis", "uk", "japan", 42])).toEqual([
      "uk",
      "japan",
    ]);
  });

  it("allows an empty favourites list", () => {
    expect(sanitizeDirectorCountries([])).toEqual([]);
  });
});

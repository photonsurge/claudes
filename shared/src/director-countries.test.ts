import {
  COUNTRY_SHOTS,
  countryShot,
  countryContaining,
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

  it("has a unique ISO-3166 alpha-2 code and a sane bbox for every country", () => {
    const codes = COUNTRY_SHOTS.map((c) => c.iso2);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of COUNTRY_SHOTS) {
      expect(c.iso2).toMatch(/^[A-Z]{2}$/);
      const [w, s, e, n] = c.bbox;
      expect(w).toBeGreaterThanOrEqual(-180);
      expect(e).toBeLessThanOrEqual(180);
      expect(w).toBeLessThan(e);
      expect(s).toBeGreaterThanOrEqual(-90);
      expect(n).toBeLessThanOrEqual(90);
      expect(s).toBeLessThan(n);
      // The framing centre should actually fall inside its own bbox.
      expect(c.center[0]).toBeGreaterThanOrEqual(w);
      expect(c.center[0]).toBeLessThanOrEqual(e);
      expect(c.center[1]).toBeGreaterThanOrEqual(s);
      expect(c.center[1]).toBeLessThanOrEqual(n);
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

describe("countryContaining", () => {
  it("finds the country whose bbox holds a point", () => {
    expect(countryContaining(2.5, 46.5)?.id).toBe("france");
    expect(countryContaining(137.5, 37.5)?.id).toBe("japan");
  });

  it("is undefined for open ocean / no match", () => {
    expect(countryContaining(-40, 30)).toBeUndefined(); // mid-Atlantic
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

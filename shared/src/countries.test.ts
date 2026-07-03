import { COUNTRY_BBOXES, getCountry, searchCountries } from "./countries";

describe("COUNTRY_BBOXES", () => {
  it("bakes a large list of countries", () => {
    expect(COUNTRY_BBOXES.length).toBeGreaterThan(150);
  });
  it("is sorted by name and has unique ids", () => {
    const names = COUNTRY_BBOXES.map((c) => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
    const ids = COUNTRY_BBOXES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it.each(COUNTRY_BBOXES)("$id has an in-range ordered bbox", (c) => {
    const [w, s, e, n] = c.bbox;
    expect(w).toBeGreaterThanOrEqual(-180);
    expect(e).toBeLessThanOrEqual(180);
    expect(w).toBeLessThan(e);
    expect(s).toBeGreaterThanOrEqual(-90);
    expect(n).toBeLessThanOrEqual(90);
    expect(s).toBeLessThan(n);
  });
  it("frames the UK on Great Britain (main landmass, not scattered isles)", () => {
    const gb = getCountry("gb");
    expect(gb).toBeDefined();
    const [w, s, e, n] = gb!.bbox;
    expect(w).toBeGreaterThan(-9);
    expect(e).toBeLessThan(3);
    expect(s).toBeGreaterThan(49);
    expect(n).toBeLessThan(61);
  });
  it("searchCountries filters by name, case-insensitively", () => {
    const r = searchCountries("king");
    expect(r.some((c) => c.id === "gb")).toBe(true);
    expect(searchCountries("").length).toBe(COUNTRY_BBOXES.length);
    expect(searchCountries("zzzznotacountry")).toEqual([]);
  });
});

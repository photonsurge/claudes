import {
  memberCountryCodes,
  regionsForCountry,
  isBboxScoped,
  isLandGroup,
} from "./region-membership";

const CATALOG = [
  { iso2: "EG", continent: "Africa" },
  { iso2: "MA", continent: "Africa" },
  { iso2: "DE", continent: "Europe" },
  { iso2: "KZ", continent: "Asia" },
  { iso2: "CN", continent: "Asia" },
  { iso2: "US", continent: "North America" },
];

describe("memberCountryCodes", () => {
  it("resolves a continent from the Country catalog's continent field", () => {
    expect(memberCountryCodes("africa", CATALOG).sort()).toEqual(["eg", "ma"]);
    expect(memberCountryCodes("asia", CATALOG).sort()).toEqual(["cn", "kz"]);
  });

  it("resolves a country-grouping sub-region from its curated list", () => {
    expect(memberCountryCodes("scandinavia", CATALOG)).toEqual(["no", "se", "fi", "dk", "is"]);
  });

  it("resolves a bbox-scoped band from its curated list (bbox applied by caller)", () => {
    expect(memberCountryCodes("amazonia", CATALOG)).toContain("br");
    expect(memberCountryCodes("us_west", CATALOG)).toEqual(["us"]);
  });

  it("returns [] for oceans / world / uncurated ids", () => {
    expect(memberCountryCodes("pacific", CATALOG)).toEqual([]);
    expect(memberCountryCodes("world", CATALOG)).toEqual([]);
    expect(memberCountryCodes("nonsense", CATALOG)).toEqual([]);
  });
});

describe("regionsForCountry (reverse relation, multi-membership)", () => {
  it("puts Egypt in Africa AND the Maghreb", () => {
    const regions = regionsForCountry("eg", "Africa");
    expect(regions).toContain("africa");
    expect(regions).toContain("maghreb");
  });

  it("keeps Kazakhstan in Asia/Central Asia and OUT of East Asia (no bbox bleed)", () => {
    const regions = regionsForCountry("kz", "Asia");
    expect(regions).toContain("asia");
    expect(regions).toContain("central_asia");
    expect(regions).not.toContain("east_asia");
  });

  it("puts Germany in Europe and Central Europe", () => {
    expect(regionsForCountry("de", "Europe")).toEqual(expect.arrayContaining(["europe", "central_europe"]));
  });
});

describe("flags", () => {
  it("marks sub-national bands bbox-scoped, country groupings not", () => {
    expect(isBboxScoped("us_west")).toBe(true);
    expect(isBboxScoped("amazonia")).toBe(true);
    expect(isBboxScoped("scandinavia")).toBe(false);
  });

  it("treats every non-ocean group as land", () => {
    expect(isLandGroup("ocean")).toBe(false);
    expect(isLandGroup("continent")).toBe(true);
    expect(isLandGroup("europe")).toBe(true);
  });
});

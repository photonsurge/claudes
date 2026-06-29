import { isoToFlag, mmsiCountry, countryNameFlag } from "./flags";

const GB = "\u{1F1EC}\u{1F1E7}"; // 🇬🇧

describe("isoToFlag", () => {
  it("maps an ISO2 code to a regional-indicator flag", () => {
    expect(isoToFlag("GB")).toBe(GB);
    expect(isoToFlag("gb")).toBe(GB); // case-insensitive
  });
  it("returns '' for invalid input", () => {
    expect(isoToFlag("")).toBe("");
    expect(isoToFlag("X")).toBe("");
    expect(isoToFlag("123")).toBe("");
    expect(isoToFlag(undefined)).toBe("");
  });
});

describe("mmsiCountry", () => {
  it("resolves the registration country from the MMSI MID", () => {
    expect(mmsiCountry("232000000")).toEqual({ name: "United Kingdom", flag: GB });
    expect(mmsiCountry("338111222")?.name).toBe("United States");
    expect(mmsiCountry("238999999")?.name).toBe("Croatia"); // 238 = HR, not GR
  });
  it("returns undefined for unknown / junk MMSI", () => {
    expect(mmsiCountry("000000000")).toBeUndefined();
    expect(mmsiCountry("999000000")).toBeUndefined();
    expect(mmsiCountry(undefined)).toBeUndefined();
  });
});

describe("countryNameFlag", () => {
  it("maps a known origin_country name to a flag", () => {
    expect(countryNameFlag("United Kingdom")).toBe(GB);
  });
  it("returns '' for unknown names", () => {
    expect(countryNameFlag("Nowhereland")).toBe("");
    expect(countryNameFlag(undefined)).toBe("");
  });
});

import {
  isEnglishLang,
  wmoAuthorityIsEnglish,
  hasEnglishInfo,
  collapseToEnglish,
} from "./language";

describe("isEnglishLang", () => {
  it("matches en and en-REGION variants, case-insensitively", () => {
    expect(isEnglishLang("en")).toBe(true);
    expect(isEnglishLang("en-US")).toBe(true);
    expect(isEnglishLang("EN-GB")).toBe(true);
    expect(isEnglishLang("en_US")).toBe(true);
    expect(isEnglishLang("  en  ")).toBe(true);
  });
  it("is false for non-English and empty/undefined", () => {
    expect(isEnglishLang("de")).toBe(false);
    expect(isEnglishLang("es-ES")).toBe(false);
    expect(isEnglishLang("eng")).toBe(false); // ISO 639-2 not used by CAP here
    expect(isEnglishLang("")).toBe(false);
    expect(isEnglishLang(undefined)).toBe(false);
  });
});

describe("wmoAuthorityIsEnglish", () => {
  it("is true when the capurl authority suffix is -en", () => {
    expect(wmoAuthorityIsEnglish("kz-kazhydromet-en/2026/07/16/x.xml")).toBe(true);
    expect(wmoAuthorityIsEnglish("us-noaa-nws-en/2026/b.xml")).toBe(true);
    expect(wmoAuthorityIsEnglish("by-belhydromet-en/12345")).toBe(true);
  });
  it("is false for native and unknown editions", () => {
    expect(wmoAuthorityIsEnglish("ru-meteo-ru/2026/x.xml")).toBe(false);
    expect(wmoAuthorityIsEnglish("pl-imgw-xx/2026/x.xml")).toBe(false);
    expect(wmoAuthorityIsEnglish("cn-cma-xx/2026/1")).toBe(false);
  });
  it("is false for non-WMO identifiers and empties", () => {
    expect(wmoAuthorityIsEnglish("URN:oid:2.49.0.1.840.0.abc")).toBe(false);
    expect(wmoAuthorityIsEnglish("")).toBe(false);
    expect(wmoAuthorityIsEnglish(undefined)).toBe(false);
  });
});

describe("hasEnglishInfo", () => {
  it("detects an English block among siblings", () => {
    expect(hasEnglishInfo([{ language: "de" }, { language: "en-GB" }])).toBe(true);
    expect(hasEnglishInfo([{ language: "de" }, { language: "fr" }])).toBe(false);
    expect(hasEnglishInfo([{}])).toBe(false);
  });
});

describe("collapseToEnglish", () => {
  it("keeps only the English block when a national sibling exists", () => {
    const de = { language: "de", headline: "Sturmwarnung" };
    const en = { language: "en", headline: "Storm Warning" };
    expect(collapseToEnglish([de, en])).toEqual([en]);
  });
  it("keeps multiple English blocks and drops all non-English", () => {
    const blocks = [
      { language: "de", headline: "a" },
      { language: "en", headline: "b" },
      { language: "en-GB", headline: "c" },
    ];
    expect(collapseToEnglish(blocks)).toEqual([blocks[1], blocks[2]]);
  });
  it("returns the input unchanged when there is no English block", () => {
    const blocks = [{ language: "de" }, { language: "fr" }];
    expect(collapseToEnglish(blocks)).toBe(blocks);
  });
  it("is a no-op for single-block alerts (WMO)", () => {
    const blocks = [{ language: undefined }];
    expect(collapseToEnglish(blocks)).toBe(blocks);
  });
});

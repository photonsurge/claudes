import {
  parseCountryInfo,
  parseGeonamesCities,
  rankFromPop,
  isGeonamesTier,
  isIanaZoneId,
  parseGeonameZoneRow,
  DEFAULT_CITIES_TIER,
} from "./geonames";

const tab = (...f: (string | number)[]) => f.join("\t");

// geoname-table columns: id, name, ascii, alt, lat, lng, fclass, fcode, cc, …, pop@14, tz@17
const cityRow = (over: Partial<{ id: string; name: string; lat: number; lng: number; fcode: string; cc: string; pop: number; tz: string }> = {}) => {
  const o = { id: "1", name: "Testville", lat: 10, lng: 20, fcode: "PPL", cc: "FR", pop: 50000, tz: "Europe/Paris", ...over };
  const f = new Array(19).fill("");
  f[0] = o.id; f[1] = o.name; f[2] = o.name; f[4] = String(o.lat); f[5] = String(o.lng);
  f[7] = o.fcode; f[8] = o.cc; f[14] = String(o.pop); f[17] = o.tz;
  return f.join("\t");
};

describe("parseCountryInfo", () => {
  it("maps ISO2 → country name and skips comment rows", () => {
    const text = ["#ISO\tISO3\t…header", tab("FR", "FRA", "250", "FR", "France"), tab("JP", "JPN", "392", "JP", "Japan")].join("\n");
    const m = parseCountryInfo(text);
    expect(m.get("FR")).toBe("France");
    expect(m.get("JP")).toBe("Japan");
    expect(m.size).toBe(2);
  });
});

describe("parseGeonamesCities", () => {
  const names = new Map([["FR", "France"]]);

  it("maps rows to docs, joining the country name and flagging capitals", () => {
    const txt = [
      cityRow({ id: "5", name: "Paris", cc: "FR", fcode: "PPLC", pop: 2_100_000 }),
      cityRow({ id: "6", name: "Lyon", cc: "FR", fcode: "PPL", pop: 500_000 }),
    ].join("\n");
    const docs = parseGeonamesCities(txt, names);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ id: "gn-5", name: "Paris", country: "France", isCapital: true, rank: 0 });
    expect(docs[1]).toMatchObject({ name: "Lyon", isCapital: false, rank: 4 });
  });

  it("drops rows without a name or valid coordinates, and blanks unknown countries", () => {
    const txt = [
      cityRow({ name: "", pop: 10000 }), // no name → dropped
      cityRow({ id: "9", name: "Nowhere", lat: NaN as unknown as number }), // bad lat → dropped
      cityRow({ id: "3", name: "Xtown", cc: "ZZ", pop: 20000 }), // unknown cc → blank country
    ].join("\n");
    const docs = parseGeonamesCities(txt, names);
    expect(docs.map((d) => d.name)).toEqual(["Xtown"]);
    expect(docs[0].country).toBe("");
  });

  it("keeps the gazetteer's IANA timezone, trimming a CRLF dump's trailing \\r", () => {
    const txt = [
      cityRow({ id: "7", name: "Tokyo", tz: "Asia/Tokyo" }),
      `${cityRow({ id: "8", name: "Kolkata", tz: "Asia/Kolkata" })}\r`,
    ].join("\n");
    const docs = parseGeonamesCities(txt, names);
    expect(docs.map((d) => d.timezone)).toEqual(["Asia/Tokyo", "Asia/Kolkata"]);
  });

  it("omits the field entirely when the timezone cell is blank or mangled", () => {
    const txt = [cityRow({ id: "7", tz: "" }), cityRow({ id: "8", tz: "not a zone" })].join("\n");
    const docs = parseGeonamesCities(txt, names);
    expect(docs.every((d) => d.timezone === undefined)).toBe(true);
  });
});

describe("isIanaZoneId", () => {
  it("accepts two- and three-segment zone ids", () => {
    expect(isIanaZoneId("Asia/Tokyo")).toBe(true);
    expect(isIanaZoneId("America/Argentina/Salta")).toBe(true);
    expect(isIanaZoneId("America/Port-au-Prince")).toBe(true);
    expect(isIanaZoneId("Etc/GMT+5")).toBe(true);
  });

  it("rejects blanks, prose and bare words", () => {
    expect(isIanaZoneId("")).toBe(false);
    expect(isIanaZoneId("not a zone")).toBe(false);
    expect(isIanaZoneId("Tokyo")).toBe(false);
    expect(isIanaZoneId("Asia/Tokyo\r")).toBe(false);
  });
});

describe("rankFromPop / tiers", () => {
  it("ranks by population, capitals always 0", () => {
    expect(rankFromPop(0, true)).toBe(0);
    expect(rankFromPop(6_000_000, false)).toBe(0);
    expect(rankFromPop(120_000, false)).toBe(7);
    expect(rankFromPop(5_000, false)).toBe(9);
  });
  it("validates tier ids", () => {
    expect(isGeonamesTier(DEFAULT_CITIES_TIER)).toBe(true);
    expect(isGeonamesTier("cities5000")).toBe(true);
    expect(isGeonamesTier("cities99")).toBe(false);
  });
});

describe("parseGeonameZoneRow", () => {
  it("reads id + zone off a row without building a city doc", () => {
    expect(parseGeonameZoneRow(cityRow({ id: "1850147", tz: "Asia/Tokyo" }))).toEqual({
      id: "gn-1850147",
      timezone: "Asia/Tokyo",
    });
  });

  it("stamps the same gn- id the seed writes, so a backfill matches by it", () => {
    const row = cityRow({ id: "42" });
    const [doc] = parseGeonamesCities(row, new Map());
    expect(parseGeonameZoneRow(row)!.id).toBe(doc.id);
  });

  it("returns null for a blank line, a zone-less row and a mangled zone", () => {
    expect(parseGeonameZoneRow("")).toBeNull();
    expect(parseGeonameZoneRow(cityRow({ tz: "" }))).toBeNull();
    expect(parseGeonameZoneRow(cityRow({ tz: "somewhere" }))).toBeNull();
  });

  it("survives a truncated row rather than throwing", () => {
    expect(parseGeonameZoneRow("123\tOnly\tTwo")).toBeNull();
  });
});

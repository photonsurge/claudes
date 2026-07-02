import {
  parseCountryInfo,
  parseGeonamesCities,
  rankFromPop,
  isGeonamesTier,
  DEFAULT_CITIES_TIER,
} from "./geonames";

const tab = (...f: (string | number)[]) => f.join("\t");

// geoname-table columns: id, name, ascii, alt, lat, lng, fclass, fcode, cc, …, pop@14
const cityRow = (over: Partial<{ id: string; name: string; lat: number; lng: number; fcode: string; cc: string; pop: number }> = {}) => {
  const o = { id: "1", name: "Testville", lat: 10, lng: 20, fcode: "PPL", cc: "FR", pop: 50000, ...over };
  const f = new Array(15).fill("");
  f[0] = o.id; f[1] = o.name; f[2] = o.name; f[4] = String(o.lat); f[5] = String(o.lng);
  f[7] = o.fcode; f[8] = o.cc; f[14] = String(o.pop);
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

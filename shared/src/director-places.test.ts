import { countryShotForCountryId, normalisePlace, resolvePlaceQuery } from "./director-places";

const hit = (q: string) => {
  const m = resolvePlaceQuery(q);
  return m ? `${m.kind}:${m.shot.id}` : null;
};

describe("normalisePlace", () => {
  it("folds case, accents, punctuation and a leading 'the'", () => {
    expect(normalisePlace("  The Côte-d'Ivoire! ")).toBe("cote d ivoire");
    expect(normalisePlace("THE   ALPS")).toBe("alps");
  });
});

describe("resolvePlaceQuery", () => {
  it("matches a country by name, id, ISO code and alias", () => {
    expect(hit("Japan")).toBe("country:japan");
    expect(hit("united kingdom")).toBe("country:uk");
    expect(hit("UK")).toBe("country:uk");
    expect(hit("GB")).toBe("country:uk");
    expect(hit("Britain")).toBe("country:uk");
    expect(hit("USA")).toBe("country:usa");
    expect(hit("america")).toBe("country:usa");
  });

  it("matches a prefix of three letters or more, never shorter", () => {
    expect(hit("jap")).toBe("country:japan");
    expect(hit("ja")).toBeNull();
  });

  it("prefers an exact area over a word inside a country's name", () => {
    expect(hit("africa")).toBe("region:africa");
  });

  it("breaks a tie between a country and an area in the country's favour", () => {
    // "south" starts "South Africa" / "South Korea" (countries) and
    // "Southern Africa" (an area); a country wins, the shortest name first.
    expect(hit("south")).toBe("country:south-korea");
  });

  it("finds areas", () => {
    const area = resolvePlaceQuery("iberia");
    expect(area?.kind).toBe("region");
  });

  it("returns null for nonsense and empty input", () => {
    expect(hit("narnia")).toBeNull();
    expect(hit("   ")).toBeNull();
  });

  it("prefers an exact hit over a prefix hit", () => {
    // "chile" is exact; "china" would only be a 3-letter prefix match for "chi".
    expect(hit("chile")).toBe("country:chile");
  });
});

describe("countryShotForCountryId", () => {
  it("maps a Country doc id (lowercase ISO) to the curated shot", () => {
    expect(countryShotForCountryId("gb")?.id).toBe("uk");
    expect(countryShotForCountryId("jp")?.id).toBe("japan");
    expect(countryShotForCountryId("zz")).toBeUndefined();
  });
});

import { alertCountryCode, alertCountryLabel, alertCountryName, countryNameOf, flagOf } from "./country";

describe("alertCountryCode", () => {
  const cases: [string, { source?: string; identifier?: string }, string | undefined][] = [
    ["a dotted meteoalarm identifier", { source: "meteoalarm", identifier: "2.49.0.1.AT.240101.123" }, "AT"],
    ["a WMO capurl lead", { source: "wmo", identifier: "by-belhydromet-en/12345" }, "BY"],
    ["NWS (US-only)", { source: "nws", identifier: "urn:oid:2.49.0.1.840.0.abc" }, "US"],
    ["an unknown source", { source: "gdacs", identifier: "EQ1234567" }, undefined],
    ["a missing identifier", { source: "gdacs" }, undefined],
  ];
  it.each(cases)("decodes %s", (_name, alert, expected) => {
    expect(alertCountryCode(alert)).toBe(expected);
  });
});

describe("flagOf", () => {
  it("maps an ISO-3166 alpha-2 to regional-indicator symbols", () => {
    expect(flagOf("CH")).toBe("🇨🇭");
  });

  it("accepts lowercase", () => {
    expect(flagOf("ch")).toBe("🇨🇭");
  });
});

describe("countryNameOf", () => {
  it("resolves a display name", () => {
    expect(countryNameOf("CH")).toBe("Switzerland");
  });

  it("upper-cases the input", () => {
    expect(countryNameOf("ch")).toBe("Switzerland");
  });

  // Intl echoes unassigned codes straight back, so an undecodable feed value
  // still renders as something rather than blanking the column.
  it("falls back to the code itself for an unassigned region", () => {
    expect(countryNameOf("qq")).toBe("QQ");
  });
});

describe("alertCountryName", () => {
  // The sort key the admin alerts table orders by — it must be the bare name, as
  // the flag-prefixed label would order by ISO code instead of alphabetically.
  it("returns the name with no flag prefix", () => {
    expect(alertCountryName({ source: "meteoalarm", identifier: "2.49.0.1.CH.240101" })).toBe("Switzerland");
  });

  it("returns undefined when the country can't be decoded", () => {
    expect(alertCountryName({ source: "gdacs", identifier: "EQ123" })).toBeUndefined();
  });
});

describe("alertCountryLabel", () => {
  it("renders flag + name", () => {
    expect(alertCountryLabel({ source: "meteoalarm", identifier: "2.49.0.1.CH.240101" })).toBe("🇨🇭 Switzerland");
  });

  it("returns undefined when the country can't be decoded", () => {
    expect(alertCountryLabel({ source: "gdacs", identifier: "EQ123" })).toBeUndefined();
  });
});

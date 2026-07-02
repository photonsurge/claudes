import { parseStations, parseSeries } from "./ioc";

describe("parseStations", () => {
  const rows = [
    { Code: "abas", Location: "Abashiri", lat: 44.02, lon: 144.28, country: "JPN", sensor: "prs", status: "1" },
    { Code: "abas", Location: "Abashiri", lat: 44.02, lon: 144.28, country: "JPN", sensor: "rad", status: "1" },
    { Code: "abas", Location: "Abashiri", lat: 44.02, lon: 144.28, country: "JPN", sensor: "bat", status: "1" },
    { Code: "dead", Location: "Offline", lat: 10, lon: 10, sensor: "prs", status: "4" },
    { Code: "wind", Location: "Met only", lat: 20, lon: 20, sensor: "wspd", status: "1" },
  ];

  it("collapses a station's sensors to one entry, preferring the best water channel", () => {
    const out = parseStations(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ stationId: "abas", provider: "ioc", name: "Abashiri", lat: 44.02, lng: 144.28, sensor: "prs" });
  });

  it("drops discontinued stations and non-sea-level-only stations", () => {
    const codes = parseStations(rows).map((s) => s.stationId);
    expect(codes).not.toContain("dead");
    expect(codes).not.toContain("wind");
  });

  it("tolerates capitalised lat/lon keys and missing coords", () => {
    const out = parseStations([
      { Code: "x", Location: "X", Lat: 1, Lon: 2, sensor: "rad", status: "1" },
      { Code: "y", Location: "Y", sensor: "rad", status: "1" }, // no coords → skipped
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ stationId: "x", lat: 1, lng: 2 });
  });

  it("returns [] for a non-array payload", () => {
    expect(parseStations(null)).toEqual([]);
    expect(parseStations({ error: "nope" })).toEqual([]);
  });
});

describe("parseSeries", () => {
  const rows = [
    { slevel: 1.27, stime: "2026-07-02 02:29:00", sensor: "prs" },
    { slevel: 1.31, stime: "2026-07-02 02:30:00", sensor: "prs" },
    { slevel: 12.4, stime: "2026-07-02 02:30:00", sensor: "bat" }, // battery — ignored
  ];

  it("parses water-level samples to epoch ms, oldest→newest", () => {
    const out = parseSeries(rows);
    expect(out).toEqual([
      { t: Date.parse("2026-07-02T02:29:00Z"), v: 1.27 },
      { t: Date.parse("2026-07-02T02:30:00Z"), v: 1.31 },
    ]);
  });

  it("honours an explicit sensor channel", () => {
    const out = parseSeries(rows, "prs");
    expect(out.every((s) => Number.isFinite(s.v))).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("returns [] for a non-array payload", () => {
    expect(parseSeries(undefined)).toEqual([]);
  });
});

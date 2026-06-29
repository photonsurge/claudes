import { parseUsgs, isValidFeed, DEFAULT_USGS_FEED } from "./usgs";

describe("parseUsgs", () => {
  const json = {
    type: "FeatureCollection",
    features: [
      {
        id: "us7000abcd",
        properties: { mag: 5.2, place: "12km SSW of Town", time: 1718000000000, url: "http://x", tsunami: 1 },
        geometry: { type: "Point", coordinates: [-122.5, 38.1, 10.4] },
      },
      {
        id: "us7000efgh",
        properties: { mag: 2.6, place: "near Somewhere", time: 1718000100000, tsunami: 0 },
        geometry: { type: "Point", coordinates: [140.2, -3.5, 70] },
      },
      // dropped — no magnitude
      { id: "nomag", properties: { mag: null }, geometry: { type: "Point", coordinates: [0, 0, 0] } },
      // dropped — no coordinates
      { id: "nogeo", properties: { mag: 4.0 }, geometry: null },
    ],
  };
  const rows = parseUsgs(json);

  it("keeps quakes with a magnitude and position", () => {
    expect(rows).toHaveLength(2);
    const q = rows[0];
    expect(q.id).toBe("us7000abcd");
    expect(q.mag).toBe(5.2);
    expect(q.place).toBe("12km SSW of Town");
    expect(q.lng).toBe(-122.5);
    expect(q.lat).toBe(38.1);
    expect(q.depthKm).toBeCloseTo(10.4, 1);
    expect(q.tsunami).toBe(true);
  });

  it("leaves tsunami undefined when not flagged", () => {
    expect(rows[1].tsunami).toBeUndefined();
  });

  it("returns [] for malformed input", () => {
    expect(parseUsgs(null)).toEqual([]);
    expect(parseUsgs({})).toEqual([]);
    expect(parseUsgs({ features: "nope" })).toEqual([]);
  });
});

describe("isValidFeed", () => {
  it("accepts known feeds and rejects others", () => {
    expect(isValidFeed("2.5_day")).toBe(true);
    expect(isValidFeed(DEFAULT_USGS_FEED)).toBe(true);
    expect(isValidFeed("hourly")).toBe(false);
  });
});

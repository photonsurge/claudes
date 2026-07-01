import { parseCablesGeo, parseLandingsGeo } from "./telegeography";

describe("parseCablesGeo", () => {
  it("parses a LineString cable into a single path", () => {
    const cables = parseCablesGeo({
      features: [
        {
          properties: { id: "alpha", name: "Alpha", color: "#ff0000" },
          geometry: { type: "LineString", coordinates: [[0, 0], [10, 10]] },
        },
      ],
    });
    expect(cables).toEqual([
      { id: "alpha", name: "Alpha", color: "#ff0000", paths: [[[0, 0], [10, 10]]] },
    ]);
  });

  it("parses a MultiLineString cable into several paths", () => {
    const [cable] = parseCablesGeo({
      features: [
        {
          properties: { id: "beta", name: "Beta" },
          geometry: {
            type: "MultiLineString",
            coordinates: [
              [[0, 0], [1, 1]],
              [[5, 5], [6, 6]],
            ],
          },
        },
      ],
    });
    expect(cable.paths).toHaveLength(2);
    expect(cable.color).toBeUndefined();
    expect(cable.name).toBe("Beta");
  });

  it("drops features with no id, no geometry, or degenerate paths", () => {
    const cables = parseCablesGeo({
      features: [
        { properties: { name: "no id" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
        { properties: { id: "single-point" }, geometry: { type: "LineString", coordinates: [[0, 0]] } },
        { properties: { id: "empty-multi" }, geometry: { type: "MultiLineString", coordinates: [] } },
        { properties: { id: "bad-coords" }, geometry: { type: "LineString", coordinates: [["x", "y"], [1, 1]] } },
      ],
    });
    expect(cables).toEqual([]);
  });

  it("merges several features that share one cable id into one cable", () => {
    // The source splits some cables into multiple feature_id segments under one id.
    const cables = parseCablesGeo({
      features: [
        {
          properties: { id: "split", name: "Split Cable", feature_id: "split-0" },
          geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
        },
        {
          properties: { id: "split", name: "Split Cable", feature_id: "split-1" },
          geometry: { type: "LineString", coordinates: [[5, 5], [6, 6]] },
        },
      ],
    });
    expect(cables).toHaveLength(1);
    expect(cables[0].id).toBe("split");
    expect(cables[0].paths).toEqual([
      [[0, 0], [1, 1]],
      [[5, 5], [6, 6]],
    ]);
  });

  it("falls back to id when name is missing and tolerates junk input", () => {
    const [cable] = parseCablesGeo({
      features: [
        { properties: { id: "gamma" }, geometry: { type: "LineString", coordinates: [[0, 0], [2, 2]] } },
      ],
    });
    expect(cable.name).toBe("gamma");
    expect(parseCablesGeo(null)).toEqual([]);
    expect(parseCablesGeo({})).toEqual([]);
  });
});

describe("parseLandingsGeo", () => {
  it("parses Point features into landing stations", () => {
    const landings = parseLandingsGeo({
      features: [
        { properties: { id: "ldn", name: "London" }, geometry: { type: "Point", coordinates: [-0.1, 51.5] } },
      ],
    });
    expect(landings).toEqual([{ id: "ldn", name: "London", lng: -0.1, lat: 51.5 }]);
  });

  it("drops non-Point or malformed features", () => {
    const landings = parseLandingsGeo({
      features: [
        { properties: { id: "line" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
        { properties: { id: "no-coords" }, geometry: { type: "Point", coordinates: [0] } },
        { properties: {}, geometry: { type: "Point", coordinates: [1, 1] } },
      ],
    });
    expect(landings).toEqual([]);
    expect(parseLandingsGeo(null)).toEqual([]);
  });
});

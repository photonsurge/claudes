import { parseFaultsGeo } from "./bird";

describe("parseFaultsGeo", () => {
  it("parses a LineString boundary into a single path", () => {
    const faults = parseFaultsGeo({
      features: [
        {
          properties: { Name: "AF-AN", Type: "" },
          geometry: { type: "LineString", coordinates: [[0, 0], [10, 10]] },
        },
      ],
    });
    expect(faults).toEqual([
      { id: "AF-AN-0", name: "AF-AN", type: undefined, paths: [[[0, 0], [10, 10]]] },
    ]);
  });

  it("parses a MultiLineString boundary into several paths", () => {
    const [fault] = parseFaultsGeo({
      features: [
        {
          properties: { Name: "NA-PA" },
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
    expect(fault.paths).toHaveLength(2);
    expect(fault.name).toBe("NA-PA");
  });

  it("mints deterministic per-name ids for repeated plate pairs", () => {
    const faults = parseFaultsGeo({
      features: [
        { properties: { Name: "AF-AN" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
        { properties: { Name: "AF-AN" }, geometry: { type: "LineString", coordinates: [[2, 2], [3, 3]] } },
        { properties: { Name: "NA-PA" }, geometry: { type: "LineString", coordinates: [[4, 4], [5, 5]] } },
      ],
    });
    expect(faults.map((f) => f.id)).toEqual(["AF-AN-0", "AF-AN-1", "NA-PA-0"]);
  });

  it("keeps a Type when present", () => {
    const [fault] = parseFaultsGeo({
      features: [
        {
          properties: { Name: "SU-PS", Type: "subduction" },
          geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        },
      ],
    });
    expect(fault.type).toBe("subduction");
  });

  it("drops features with no geometry or degenerate paths, tolerates junk", () => {
    const faults = parseFaultsGeo({
      features: [
        { properties: { Name: "single-point" }, geometry: { type: "LineString", coordinates: [[0, 0]] } },
        { properties: { Name: "empty-multi" }, geometry: { type: "MultiLineString", coordinates: [] } },
        { properties: { Name: "bad-coords" }, geometry: { type: "LineString", coordinates: [["x", "y"], [1, 1]] } },
        { properties: { Name: "no-geom" } },
      ],
    });
    expect(faults).toEqual([]);
    expect(parseFaultsGeo(null)).toEqual([]);
    expect(parseFaultsGeo({})).toEqual([]);
  });

  it("falls back to a boundary name when Name is missing", () => {
    const [fault] = parseFaultsGeo({
      features: [
        { properties: {}, geometry: { type: "LineString", coordinates: [[0, 0], [2, 2]] } },
      ],
    });
    expect(fault.id).toBe("boundary-0");
    expect(fault.name).toBe("boundary");
  });
});

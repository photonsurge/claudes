import { parseNutsFeatures } from "./nutsBoundaries";

/** A minimal GISCO NUTS feature collection. */
const fc = (features: any[]) => JSON.stringify({ type: "FeatureCollection", features });
const poly = (n: number) => ({
  type: "Polygon",
  coordinates: [[[n, n], [n + 1, n], [n + 1, n + 1], [n, n + 1], [n, n]]],
});

describe("parseNutsFeatures", () => {
  it("maps LEVL_CODE to the scheme the feed uses (NUTS2/NUTS3)", () => {
    const { areas } = parseNutsFeatures(
      fc([
        { properties: { NUTS_ID: "FR715", LEVL_CODE: 3, CNTR_CODE: "FR", NUTS_NAME: "Loire" }, geometry: poly(1) },
        { properties: { NUTS_ID: "HU33", LEVL_CODE: 2, CNTR_CODE: "HU", NUTS_NAME: "Dél-Alföld" }, geometry: poly(5) },
      ]),
    );

    expect(areas.map((a) => [a.scheme, a.code])).toEqual([
      ["NUTS3", "FR715"],
      ["NUTS2", "HU33"],
    ]);
    expect(areas[0]).toMatchObject({ countryCode: "FR", name: "Loire", source: expect.stringContaining("gisco:nuts-") });
  });

  it("skips a feature with no NUTS_ID", () => {
    const { areas, skipped } = parseNutsFeatures(
      fc([{ properties: { LEVL_CODE: 3 }, geometry: poly(1) }]),
    );
    expect(areas).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a feature with no LEVL_CODE (can't name its scheme)", () => {
    const { areas, skipped } = parseNutsFeatures(
      fc([{ properties: { NUTS_ID: "FR715" }, geometry: poly(1) }]),
    );
    expect(areas).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a feature whose geometry can't be stored", () => {
    const { areas, skipped } = parseNutsFeatures(
      fc([{ properties: { NUTS_ID: "FR715", LEVL_CODE: 3 }, geometry: null }]),
    );
    expect(areas).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("returns nothing for non-JSON rather than throwing", () => {
    expect(parseNutsFeatures("<html>404</html>")).toEqual({ areas: [], skipped: 0 });
  });

  it("carries a real MultiPolygon through intact", () => {
    const multi = {
      type: "MultiPolygon",
      coordinates: [poly(1).coordinates, poly(9).coordinates],
    };
    const { areas } = parseNutsFeatures(
      fc([{ properties: { NUTS_ID: "FR715", LEVL_CODE: 3 }, geometry: multi }]),
    );
    expect(areas).toHaveLength(1);
    expect(areas[0].geometry.type).toBe("MultiPolygon");
  });
});

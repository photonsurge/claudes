import { parseGadmFeatures } from "./gadmBoundaries";

const fc = (features: any[]) => JSON.stringify({ type: "FeatureCollection", features });
const poly = (n: number) => ({
  type: "Polygon",
  coordinates: [[[n, n], [n + 1, n], [n + 1, n + 1], [n, n + 1], [n, n]]],
});

describe("parseGadmFeatures", () => {
  it("keys a county on GID_3 (code) and a folded NAME_3 (nameKey)", () => {
    const { areas } = parseGadmFeatures(
      fc([{ properties: { GID_3: "CHN.1.1.1_1", NAME_3: "Anqing", GID_0: "CHN" }, geometry: poly(115) }]),
    );
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({
      scheme: "GADM3",
      code: "CHN.1.1.1_1",
      name: "Anqing",
      nameKey: "anqing",
      countryCode: "CN",
      source: "gadm-4.1",
    });
  });

  it("computes a centroid for disambiguation", () => {
    const { areas } = parseGadmFeatures(
      fc([{ properties: { GID_3: "X", NAME_3: "Pingxiang" }, geometry: poly(113) }]),
    );
    // Mean of poly(113)'s ring ≈ [113.5, 113.5].
    expect(areas[0].centroid?.[0]).toBeCloseTo(113.5);
    expect(areas[0].centroid?.[1]).toBeCloseTo(113.5);
  });

  it("folds the admin-type suffix out of the nameKey so the CMA join lands", () => {
    // GADM's NAME_3 sometimes carries the type ("... City"); the feed does too. Both fold equal.
    const { areas } = parseGadmFeatures(
      fc([{ properties: { GID_3: "Y", NAME_3: "Tengzhou City" }, geometry: poly(117) }]),
    );
    expect(areas[0].nameKey).toBe("tengzhou");
  });

  it("skips a feature with no NAME_3 (nothing to join on)", () => {
    const { areas, skipped } = parseGadmFeatures(
      fc([{ properties: { GID_3: "Z" }, geometry: poly(1) }]),
    );
    expect(areas).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a feature with no GID_3 (no unique key)", () => {
    const { areas, skipped } = parseGadmFeatures(
      fc([{ properties: { NAME_3: "Anqing" }, geometry: poly(1) }]),
    );
    expect(areas).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips a feature whose geometry can't be stored", () => {
    const { areas, skipped } = parseGadmFeatures(
      fc([{ properties: { GID_3: "Z", NAME_3: "Anqing" }, geometry: null }]),
    );
    expect(areas).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("returns nothing for non-JSON rather than throwing", () => {
    expect(parseGadmFeatures("<html>404</html>")).toEqual({ areas: [], skipped: 0 });
  });
});

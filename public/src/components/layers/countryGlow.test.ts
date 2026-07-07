import { countryGlowLayers } from "./countryGlow";

/** A Polygon feature with the given ISO2 and a square boundary. */
function countryFeature(iso2: string, [w, s, e, n]: [number, number, number, number]) {
  return {
    type: "Feature",
    properties: { iso_a2: iso2 },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [w, s],
          [e, s],
          [e, n],
          [w, n],
          [w, s],
        ],
      ],
    },
  };
}

/** A MultiPolygon straddling the antimeridian (Russia-shaped): a big western
 *  part plus a small eastern sliver near 180°, split as separate rings the way
 *  real country geojson does it — never one part spanning [-180, 180]. */
function straddlingFeature(iso2: string) {
  return {
    type: "Feature",
    properties: { iso_a2: iso2 },
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [30, 50],
            [179, 50],
            [179, 70],
            [30, 70],
            [30, 50],
          ],
        ],
        [
          [
            [-179, 50],
            [-170, 50],
            [-170, 70],
            [-179, 70],
            [-179, 50],
          ],
        ],
      ],
    },
  };
}

/** loadCountryFeatures() memoizes its fetch at module scope (one shared fetch
 *  across every Globe instance in production) — so each test needs its own
 *  fresh module instance rather than sharing that cache across fixtures. */
async function freshModule(features: unknown[]) {
  jest.resetModules();
  global.fetch = jest.fn(async () => ({
    json: async () => ({ features }),
  })) as unknown as typeof fetch;
  return (await import("./countryGlow")) as typeof import("./countryGlow");
}

describe("countriesInBbox / countryFeatureFor", () => {
  it("resolves a single country by ISO2", async () => {
    const { countryFeatureFor } = await freshModule([
      countryFeature("PT", [-10, 36, -6, 42]),
      countryFeature("ES", [-9, 36, 3, 44]),
    ]);
    const f = await countryFeatureFor("pt");
    expect(f?.properties.iso_a2).toBe("PT");
  });

  it("is null for an unknown ISO2", async () => {
    const { countryFeatureFor } = await freshModule([countryFeature("PT", [-10, 36, -6, 42])]);
    expect(await countryFeatureFor("zz")).toBeNull();
  });

  it("returns every country whose boundary overlaps the framed bbox", async () => {
    const { countriesInBbox } = await freshModule([
      countryFeature("PT", [-10, 36, -6, 42]),
      countryFeature("ES", [-9, 36, 3, 44]),
      countryFeature("JP", [129, 31, 146, 45]), // far away — no overlap
    ]);
    const hits = await countriesInBbox([-11, 35, 4, 45]);
    expect(hits.map((f) => f.properties.iso_a2).sort()).toEqual(["ES", "PT"]);
  });

  it("excludes countries entirely outside the framed bbox", async () => {
    const { countriesInBbox } = await freshModule([countryFeature("PT", [-10, 36, -6, 42])]);
    expect(await countriesInBbox([100, -10, 120, 10])).toEqual([]);
  });

  it("tests a MultiPolygon's parts independently, not one bogus antimeridian-spanning box", async () => {
    const { countriesInBbox } = await freshModule([straddlingFeature("RU")]);
    // A framed box over Scandinavia overlaps RU's western part only.
    expect((await countriesInBbox([0, 40, 40, 75])).map((f) => f.properties.iso_a2)).toEqual(["RU"]);
    // A framed box over central Africa should NOT match despite RU's western
    // part reaching to 179°E — it must not collapse to a globe-spanning box.
    expect(await countriesInBbox([0, -20, 30, 10])).toEqual([]);
  });
});

describe("countryGlowLayers", () => {
  it("returns no layers when there is nothing to glow", () => {
    expect(countryGlowLayers([], 0)).toEqual([]);
  });

  it("draws the same layer stack for one or several features", () => {
    const one = countryGlowLayers([countryFeature("PT", [-10, 36, -6, 42])], 0) as { props: { id: string } }[];
    const many = countryGlowLayers(
      [countryFeature("PT", [-10, 36, -6, 42]), countryFeature("ES", [-9, 36, 3, 44])],
      0,
    ) as { props: { id: string; data: unknown[] } }[];
    expect(one.map((l) => l.props.id)).toEqual(many.map((l) => l.props.id));
    expect(many[0].props.data).toHaveLength(2);
  });
});

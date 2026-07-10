import { countryGlowLayers, cyclePalette } from "./countryGlow";

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

  it("omits the interior fill when opts.fill is false", () => {
    const ids = (countryGlowLayers([countryFeature("PT", [-10, 36, -6, 42])], 0, { fill: false }) as {
      props: { id: string };
    }[]).map((l) => l.props.id);
    expect(ids).not.toContain("country-glow-fill");
    expect(ids).toContain("country-glow-edge");
  });

  it("colours each feature from its flag palette when paletteFor is given", () => {
    // Red palette for PT, blue for ES — the bloom's getLineColor accessor should
    // return each feature's own (lightened) flag hue, not one shared colour.
    const paletteFor = (iso: string) =>
      iso === "PT" ? ([[220, 20, 20]] as [number, number, number][]) : ([[20, 20, 220]] as [number, number, number][]);
    const [bloom] = countryGlowLayers(
      [countryFeature("PT", [-10, 36, -6, 42]), countryFeature("ES", [-9, 36, 3, 44])],
      0,
      { fill: false, paletteFor },
    ) as { props: { getLineColor: (f: unknown) => number[] } }[];
    const pt = bloom.props.getLineColor(countryFeature("PT", [0, 0, 1, 1]));
    const es = bloom.props.getLineColor(countryFeature("ES", [0, 0, 1, 1]));
    expect(pt[0]).toBeGreaterThan(pt[2]); // reddish
    expect(es[2]).toBeGreaterThan(es[0]); // bluish
  });

  it("falls back to the base colour for a feature with no palette", () => {
    const paletteFor = () => null;
    const [bloom] = countryGlowLayers([countryFeature("ZZ", [0, 0, 1, 1])], 0, {
      fill: false,
      color: [255, 255, 255],
      paletteFor,
    }) as { props: { getLineColor: (f: unknown) => number[] } }[];
    const c = bloom.props.getLineColor(countryFeature("ZZ", [0, 0, 1, 1]));
    // White base, lightened + alpha — the rgb channels stay equal (neutral).
    expect(c[0]).toBe(c[1]);
    expect(c[1]).toBe(c[2]);
  });
});

describe("cyclePalette", () => {
  it("returns the single colour for a one-colour palette", () => {
    expect(cyclePalette([[10, 20, 30]], 999)).toEqual([10, 20, 30]);
  });

  it("returns white for an empty palette", () => {
    expect(cyclePalette([], 0)).toEqual([255, 255, 255]);
  });

  it("sits on the first colour at t=0 and the second at one dwell", () => {
    const pal: [number, number, number][] = [
      [200, 0, 0],
      [0, 0, 200],
    ];
    expect(cyclePalette(pal, 0, 1000)).toEqual([200, 0, 0]);
    expect(cyclePalette(pal, 1000, 1000)).toEqual([0, 0, 200]);
  });

  it("blends halfway between adjacent colours", () => {
    const pal: [number, number, number][] = [
      [200, 0, 0],
      [0, 0, 200],
    ];
    expect(cyclePalette(pal, 500, 1000)).toEqual([100, 0, 100]);
  });

  it("wraps from the last colour back to the first", () => {
    const pal: [number, number, number][] = [
      [200, 0, 0],
      [0, 200, 0],
    ];
    // t = 2 → back to the first colour.
    expect(cyclePalette(pal, 2000, 1000)).toEqual([200, 0, 0]);
  });

  it("is negative-time safe", () => {
    const pal: [number, number, number][] = [
      [200, 0, 0],
      [0, 0, 200],
    ];
    const c = cyclePalette(pal, -500, 1000);
    for (const ch of c) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(255);
    }
  });
});

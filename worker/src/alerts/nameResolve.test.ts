import { resolveAreaNames, geomAnchor, NameArea } from "./nameResolve";
import type { AdminAreaCandidate } from "@photonsurge/shared/db/admin-area-geom-repo";

/** A tiny square polygon centred on [x, y]. */
const sq = (x: number, y: number): any => ({
  type: "Polygon",
  coordinates: [[[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x - 1, y - 1]]],
});
const cand = (code: string, x: number, y: number): AdminAreaCandidate => ({
  code,
  centroid: [x, y],
  geometry: sq(x, y),
});
/** gadmNameKey folds "Foo County" → "foo"; keep test names pre-folded for clarity. */
const cache = (m: Record<string, AdminAreaCandidate[]>) => new Map(Object.entries(m));

describe("geomAnchor", () => {
  it("returns the mean vertex of a Polygon's outer ring", () => {
    expect(geomAnchor(sq(10, 20))).toEqual([10, 20]);
  });
  it("drills into a MultiPolygon's first ring", () => {
    const mp = { type: "MultiPolygon", coordinates: [sq(5, 6).coordinates, sq(99, 99).coordinates] };
    expect(geomAnchor(mp as any)).toEqual([5, 6]);
  });
  it("is null for a geometry with no coordinates", () => {
    expect(geomAnchor(null)).toBeNull();
    expect(geomAnchor({ type: "Polygon" } as any)).toBeNull();
  });
});

describe("resolveAreaNames — unique names (Pass A)", () => {
  it("fills an area whose name maps to exactly one county", () => {
    const areas: NameArea[] = [{ areaDesc: "Nanchang City", geometry: null }];
    const res = resolveAreaNames(areas, cache({ nanchang: [cand("CHN.1", 115, 28)] }));
    expect(res).toEqual([{ index: 0, geometry: sq(115, 28), code: "CHN.1", disambiguated: false }]);
  });

  it("folds the admin-type suffix off the CMA name before matching", () => {
    // "Dinghai District" must match the GADM county keyed "dinghai".
    const areas: NameArea[] = [{ areaDesc: "Dinghai District", geometry: null }];
    const res = resolveAreaNames(areas, cache({ dinghai: [cand("CHN.2", 122, 30)] }));
    expect(res).toHaveLength(1);
    expect(res[0].code).toBe("CHN.2");
  });

  it("leaves an unmatched name undrawn (the ~16% mistranslations)", () => {
    const areas: NameArea[] = [{ areaDesc: "Three gate County", geometry: null }];
    expect(resolveAreaNames(areas, cache({ nanchang: [cand("CHN.1", 115, 28)] }))).toEqual([]);
  });

  it("never touches an area that already has a polygon", () => {
    const areas: NameArea[] = [{ areaDesc: "Nanchang", geometry: sq(0, 0) }];
    expect(resolveAreaNames(areas, cache({ nanchang: [cand("CHN.1", 115, 28)] }))).toEqual([]);
  });

  it("returns nothing for an empty cache without inspecting areas", () => {
    expect(resolveAreaNames([{ areaDesc: "Nanchang" }], new Map())).toEqual([]);
  });
});

describe("resolveAreaNames — ambiguous names (Pass B)", () => {
  const pingxiang = [cand("CHN.JX", 113.8, 27.6), cand("CHN.GX", 106.6, 22.1)]; // Jiangxi vs Guangxi

  it("does NOT guess an ambiguous name when the alert has no anchor", () => {
    const areas: NameArea[] = [{ areaDesc: "Pingxiang City", geometry: null }];
    expect(resolveAreaNames(areas, cache({ pingxiang }))).toEqual([]);
  });

  it("picks the candidate nearest a sibling's feed polygon", () => {
    // A sibling in Jiangxi (~[115,28]) should anchor Pingxiang to the Jiangxi county.
    const areas: NameArea[] = [
      { areaDesc: "Nanchang", geometry: sq(115.9, 28.7) },
      { areaDesc: "Pingxiang City", geometry: null },
    ];
    const res = resolveAreaNames(areas, cache({ pingxiang }));
    const px = res.find((r) => r.index === 1)!;
    expect(px.code).toBe("CHN.JX");
    expect(px.disambiguated).toBe(true);
  });

  it("uses a Pass-A unique fill as an anchor for a Pass-B ambiguous name", () => {
    // No feed polygon at all; a unique sibling ("Yichun", Jiangxi) must anchor Pingxiang.
    const areas: NameArea[] = [
      { areaDesc: "Yichun County", geometry: null },
      { areaDesc: "Pingxiang City", geometry: null },
    ];
    const res = resolveAreaNames(
      areas,
      cache({ yichun: [cand("CHN.JX.YC", 114.4, 27.8)], pingxiang }),
    );
    expect(res.find((r) => r.index === 0)!.code).toBe("CHN.JX.YC"); // unique
    expect(res.find((r) => r.index === 1)!.code).toBe("CHN.JX"); // anchored to it
  });

  it("anchors toward Guangxi when the sibling is in Guangxi", () => {
    const areas: NameArea[] = [
      { areaDesc: "Nanning", geometry: sq(108.3, 22.8) },
      { areaDesc: "Pingxiang City", geometry: null },
    ];
    const res = resolveAreaNames(areas, cache({ pingxiang }));
    expect(res.find((r) => r.index === 1)!.code).toBe("CHN.GX");
  });
});

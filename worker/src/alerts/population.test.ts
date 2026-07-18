import type { Model } from "mongoose";
import type { iCityModel } from "@photonsurge/shared/db/city-model";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";
import {
  combineGeometries,
  hasDrawableGeometry,
  populationSig,
  populationOfGeometries,
  resyncAlertPopulations,
  type PopulationCandidate,
} from "./population";

const box = (w: number, s: number, e: number, n: number): AlertGeometry => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

const city = (id: string, population?: number): Partial<iCityModel> => ({
  id,
  name: id,
  cc: "PL",
  lat: 52,
  lng: 21,
  population,
});

/** A City model returning a fixed set for any `$geoWithin` — the union fast path. */
function fixedCities(rows: Partial<iCityModel>[]) {
  const model = {
    find: () => {
      const chain = {
        hint: () => chain,
        lean: () => chain,
        exec: async () => rows,
      };
      return chain;
    },
  } as unknown as Model<iCityModel>;
  return model;
}

/**
 * A City model that rejects the FUSED MultiPolygon (as S2 does on a
 * self-intersecting union) but answers each Polygon area on its own — the
 * fallback path.
 */
function perAreaCities(byArea: Map<string, Partial<iCityModel>[]>) {
  return {
    find: (filter: { loc: { $geoWithin: { $geometry: AlertGeometry } } }) => {
      const g = filter.loc.$geoWithin.$geometry;
      const chain = {
        hint: () => chain,
        lean: () => chain,
        exec: async () => {
          if (g.type === "MultiPolygon") throw new Error("Loop is not valid");
          return byArea.get(JSON.stringify(g.coordinates)) ?? [];
        },
      };
      return chain;
    },
  } as unknown as Model<iCityModel>;
}

describe("combineGeometries", () => {
  it("fuses polygons and multipolygons into one MultiPolygon", () => {
    const out = combineGeometries([
      box(0, 0, 1, 1),
      { type: "MultiPolygon", coordinates: [box(2, 2, 3, 3).coordinates, box(4, 4, 5, 5).coordinates] },
    ]);
    expect(out?.type).toBe("MultiPolygon");
    expect((out?.coordinates as unknown[]).length).toBe(3); // 1 polygon + 2 from the multi
  });

  it("returns null when there is nothing drawable", () => {
    expect(combineGeometries([])).toBeNull();
    expect(combineGeometries([{ type: "Point", coordinates: [0, 0] } as AlertGeometry])).toBeNull();
  });
});

describe("hasDrawableGeometry", () => {
  const shaped: PopulationCandidate = { id: "a", info: [{ area: [{ geometry: { type: "Polygon" } }] }] };
  const shapeless: PopulationCandidate = { id: "b", info: [{ area: [{ areaDesc: "X", geometry: null }] }] };

  it("is true only when at least one area carries a polygon", () => {
    expect(hasDrawableGeometry(shaped)).toBe(true);
    expect(hasDrawableGeometry(shapeless)).toBe(false);
  });
});

describe("populationSig", () => {
  it("changes when an area's polygon is backfilled (null → present)", () => {
    const before: PopulationCandidate = {
      id: "a",
      sent: "T1",
      info: [{ area: [{ areaDesc: "Kraków", geometry: null }] }],
    };
    const after: PopulationCandidate = {
      id: "a",
      sent: "T1",
      info: [{ area: [{ areaDesc: "Kraków", geometry: { type: "Polygon" } }] }],
    };
    expect(populationSig(before)).not.toBe(populationSig(after));
  });

  it("changes with a new CAP version but is stable for an unchanged footprint", () => {
    const v1: PopulationCandidate = { id: "a", sent: "T1", info: [{ area: [{ areaDesc: "X", geometry: { type: "Polygon" } }] }] };
    const v2: PopulationCandidate = { id: "a", sent: "T2", info: [{ area: [{ areaDesc: "X", geometry: { type: "Polygon" } }] }] };
    expect(populationSig(v1)).not.toBe(populationSig(v2));
    expect(populationSig(v1)).toBe(populationSig({ ...v1 }));
  });
});

describe("populationOfGeometries", () => {
  it("sums the populations of the cities inside the footprint", async () => {
    const model = fixedCities([city("1", 1_790_658), city("2", 211_371)]);
    const out = await populationOfGeometries(model, [box(14, 49, 24, 55)]);
    expect(out).toEqual({ population: 2_002_029, cityCount: 2 });
  });

  it("is zero for an alert with no drawable shape", async () => {
    const model = fixedCities([city("1", 1_000)]);
    const out = await populationOfGeometries(model, []);
    expect(out).toEqual({ population: 0, cityCount: 0 });
  });

  it("counts a city under two of the alert's areas once (fallback dedups by id)", async () => {
    const areaA = box(14, 49, 19, 55);
    const areaB = box(19, 49, 24, 55);
    const model = perAreaCities(
      new Map([
        [JSON.stringify(areaA.coordinates), [city("1", 1_790_658)]],
        [JSON.stringify(areaB.coordinates), [city("1", 1_790_658)]], // same city id
      ]),
    );
    const out = await populationOfGeometries(model, [areaA, areaB]);
    expect(out).toEqual({ population: 1_790_658, cityCount: 1 });
  });
});

describe("resyncAlertPopulations", () => {
  function makeDeps(candidates: PopulationCandidate[], cityRows: Partial<iCityModel>[]) {
    const writes: { id: string; population: number | null; cityCount: number }[] = [];
    const deps = {
      alerts: {
        populationCandidates: async () => candidates,
        areaGeometries: async () => [box(14, 49, 24, 55)],
        setPopulation: async (id: string, v: { population: number | null; cityCount: number; populationSig: string }) => {
          writes.push({ id, population: v.population, cityCount: v.cityCount });
          // Mirror the store so a second pass sees the fresh signature.
          const c = candidates.find((x) => x.id === id);
          if (c) c.populationSig = v.populationSig;
        },
      },
      cities: { model: fixedCities(cityRows) },
    };
    return { deps, writes };
  }

  it("counts shaped alerts, clears shapeless ones, and skips unchanged on a second pass", async () => {
    const candidates: PopulationCandidate[] = [
      { id: "shaped", sent: "T1", info: [{ area: [{ areaDesc: "Kraków", geometry: { type: "Polygon" } }] }] },
      { id: "shapeless", sent: "T1", info: [{ area: [{ areaDesc: "Region", geometry: null }] }] },
    ];
    const { deps, writes } = makeDeps(candidates, [city("1", 500_000)]);

    const first = await resyncAlertPopulations(deps);
    expect(first).toEqual({ scanned: 2, recomputed: 1, cleared: 1, unchanged: 0 });
    expect(writes).toEqual([
      { id: "shaped", population: 500_000, cityCount: 1 },
      { id: "shapeless", population: null, cityCount: 0 },
    ]);

    // Nothing changed → the signature-gate does no geo work and no writes.
    writes.length = 0;
    const second = await resyncAlertPopulations(deps);
    expect(second).toEqual({ scanned: 2, recomputed: 0, cleared: 0, unchanged: 2 });
    expect(writes).toEqual([]);
  });

  it("force recounts everything even when the signature still matches", async () => {
    const candidates: PopulationCandidate[] = [
      { id: "a", sent: "T1", info: [{ area: [{ areaDesc: "Kraków", geometry: { type: "Polygon" } }] }] },
    ];
    const { deps, writes } = makeDeps(candidates, [city("1", 500_000)]);

    await resyncAlertPopulations(deps); // seeds the signature
    writes.length = 0;

    // No footprint change → incremental is a no-op, but force ignores the gate
    // (the cities dataset may have changed underneath the unchanged signature).
    expect((await resyncAlertPopulations(deps)).recomputed).toBe(0);
    const forced = await resyncAlertPopulations(deps, { force: true });
    expect(forced).toEqual({ scanned: 1, recomputed: 1, cleared: 0, unchanged: 0 });
    expect(writes).toEqual([{ id: "a", population: 500_000, cityCount: 1 }]);
  });

  it("recomputes an alert once its geometry is backfilled", async () => {
    const candidates: PopulationCandidate[] = [
      { id: "a", sent: "T1", info: [{ area: [{ areaDesc: "Kraków", geometry: null }] }] },
    ];
    const { deps, writes } = makeDeps(candidates, [city("1", 500_000)]);

    await resyncAlertPopulations(deps); // shapeless → cleared
    expect(writes).toEqual([{ id: "a", population: null, cityCount: 0 }]);

    // Boundary cache fills the polygon in place.
    candidates[0].info[0].area[0].geometry = { type: "Polygon" };
    writes.length = 0;
    const out = await resyncAlertPopulations(deps);
    expect(out.recomputed).toBe(1);
    expect(writes).toEqual([{ id: "a", population: 500_000, cityCount: 1 }]);
  });
});

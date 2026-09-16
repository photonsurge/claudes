/** @jest-environment node */
import {
  targetCitiesFor,
  NEAREST_CITY_COUNT,
  NEAREST_CITY_MAX_M,
  NEAREST_CITY_MIN_POP,
  TARGET_CITY_LIMIT,
  type TargetCityDeps,
} from "./target-cities";
import type { City } from "../cities";

const city = (id: string, cc = "IL", population = 50_000): City =>
  ({ id, name: id, cc, lat: 32, lng: 35, population }) as City;

/** Structural deps: the alert read + a City store whose reads are recorded. */
function makeDeps(opts: {
  alert?: Awaited<ReturnType<TargetCityDeps["alerts"]["footprintCities"]>>;
  docs?: City[];
  near?: City[];
}) {
  const calls: { getAll: Record<string, unknown>[]; find: { filter: Record<string, unknown>; limit?: number }[] } = {
    getAll: [],
    find: [],
  };
  const deps: TargetCityDeps = {
    alerts: { footprintCities: async () => opts.alert ?? null },
    cities: {
      getAll: async (query) => {
        calls.getAll.push(query);
        return { data: opts.docs ?? [] };
      },
      model: {
        find: (filter) => {
          const rec: { filter: Record<string, unknown>; limit?: number } = { filter };
          calls.find.push(rec);
          return {
            limit: (n: number) => {
              rec.limit = n;
              return { lean: () => ({ exec: async () => opts.near ?? [] }) };
            },
          };
        },
      },
    },
  };
  return { deps, calls };
}

const req = (kind: "storm" | "quake" | "volcano", subject: string | null) => ({ kind, subject, lng: 35.5, lat: 32.8 }) as const;

describe("targetCitiesFor — storm", () => {
  it("airs the cities INSIDE the footprint, in the alert's (biggest-first) order, loaded by id", async () => {
    const inside = ["tiberias", "safed", "nazareth"].map((id, i) => ({ id, name: id, lat: 32, lng: 35, population: 100_000 - i }));
    const { deps, calls } = makeDeps({
      alert: { id: "a1", source: "meteoalarm", identifier: "2.49.0.0.376.0.IL.x", cities: inside, cityCount: 3, shaped: true },
      // The store hands them back in any order; the guide keeps the alert's.
      docs: [city("nazareth"), city("tiberias"), city("safed")],
    });
    const out = await targetCitiesFor(deps, req("storm", "meteoalarm:2.49.0.0.376.0.IL.x"));
    expect(out.basis).toBe("footprint");
    expect(out.cities.map((c) => c.id)).toEqual(["tiberias", "safed", "nazareth"]);
    expect(calls.getAll[0]).toEqual({ id: { $in: ["tiberias", "safed", "nazareth"] } });
    expect(calls.find).toHaveLength(0); // no nearest scan when the footprint answers
  });

  it("caps a big footprint at the airable count and drops cities with no City doc", async () => {
    const inside = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: `c${i}`, lat: 32, lng: 35, population: 1000 - i }));
    const docs = inside.slice(0, TARGET_CITY_LIMIT).filter((c) => c.id !== "c3").map((c) => city(c.id));
    const { deps, calls } = makeDeps({
      alert: { id: "a1", source: "s", identifier: "i", cities: inside, cityCount: 12, shaped: true },
      docs,
    });
    const out = await targetCitiesFor(deps, req("storm", "s:i"));
    expect((calls.getAll[0].id as { $in: string[] }).$in).toHaveLength(TARGET_CITY_LIMIT);
    expect(out.cities.map((c) => c.id)).toEqual(["c0", "c1", "c2", "c4", "c5", "c6", "c7"]);
  });

  it("falls back to the nearest towns IN THE ALERT'S COUNTRY when the alert has no shape", async () => {
    const { deps, calls } = makeDeps({
      alert: { id: "a1", source: "meteoalarm", identifier: "2.49.0.0.376.0.IL.x", shaped: false },
      near: [city("tiberias"), city("afula")],
    });
    const out = await targetCitiesFor(deps, req("storm", "meteoalarm:2.49.0.0.376.0.IL.x"));
    expect(out.basis).toBe("nearest");
    expect(out.cities.map((c) => c.id)).toEqual(["tiberias", "afula"]);
    expect(calls.getAll).toHaveLength(0);
    const { filter, limit } = calls.find[0];
    expect(limit).toBe(NEAREST_CITY_COUNT);
    expect(filter.cc).toEqual({ $in: ["il", "IL"] });
    expect(filter.population).toEqual({ $gte: NEAREST_CITY_MIN_POP });
    expect(filter.loc).toEqual({
      $near: { $geometry: { type: "Point", coordinates: [35.5, 32.8] }, $maxDistance: NEAREST_CITY_MAX_M },
    });
  });

  it("also falls back (still in-country) when the shape holds nobody or the sweep hasn't counted it yet", async () => {
    const empty = makeDeps({ alert: { id: "a1", source: "meteoalarm", identifier: "2.49.0.0.376.0.IL.x", cities: [], cityCount: 0, shaped: true } });
    expect((await targetCitiesFor(empty.deps, req("storm", "meteoalarm:2.49.0.0.376.0.IL.x"))).basis).toBe("nearest");
    expect(empty.calls.find[0].filter.cc).toEqual({ $in: ["il", "IL"] });

    const uncounted = makeDeps({ alert: { id: "a1", source: "meteoalarm", identifier: "2.49.0.0.376.0.IL.x", shaped: true } });
    expect((await targetCitiesFor(uncounted.deps, req("storm", "meteoalarm:2.49.0.0.376.0.IL.x"))).basis).toBe("nearest");
  });

  it("drops the country filter when the alert is unknown or has no decodable country", async () => {
    const missing = makeDeps({ alert: null });
    await targetCitiesFor(missing.deps, req("storm", "gdacs:EQ123"));
    expect(missing.calls.find[0].filter.cc).toBeUndefined();

    const noCountry = makeDeps({ alert: { id: "a1", source: "gdacs", identifier: "EQ123", shaped: false } });
    await targetCitiesFor(noCountry.deps, req("storm", "gdacs:EQ123"));
    expect(noCountry.calls.find[0].filter.cc).toBeUndefined();
  });
});

describe("targetCitiesFor — point events", () => {
  it("airs the nearest towns to a quake, closest first, with no country scoping", async () => {
    const { deps, calls } = makeDeps({ near: [city("q1", "TR"), city("q2", "GR")] });
    const out = await targetCitiesFor(deps, req("quake", "us7000abcd"));
    expect(out.basis).toBe("nearest");
    expect(out.cities.map((c) => c.id)).toEqual(["q1", "q2"]);
    expect(calls.find[0].filter.cc).toBeUndefined();
    expect(calls.find[0].limit).toBe(NEAREST_CITY_COUNT);
  });

  it("returns an empty guide for a mid-ocean event (the deck self-hides)", async () => {
    const { deps } = makeDeps({ near: [] });
    expect((await targetCitiesFor(deps, req("volcano", "gvp:211060"))).cities).toEqual([]);
  });
});

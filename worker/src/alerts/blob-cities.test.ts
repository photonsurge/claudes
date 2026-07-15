import type { Model } from "mongoose";
import type { iCityModel } from "@photonsurge/shared/db/city-model";
import { attachCities, citiesIn } from "./blob-cities";
import type { AlertGeometry } from "@photonsurge/shared/db/alert-model";

/**
 * A stand-in for the City model that records what it was asked, so these can
 * assert the SHAPE of the query — pinning the geo index and not asking Mongo to
 * sort — without a live database.
 */
function mockCities(rows: Partial<iCityModel>[], onFind?: (filter: unknown) => void) {
  const calls: { filter: unknown; hint?: string; sorted: boolean }[] = [];
  const model = {
    find: (filter: unknown, _proj: unknown) => {
      onFind?.(filter);
      const call: { filter: unknown; hint?: string; sorted: boolean } = { filter, sorted: false };
      calls.push(call);
      const chain = {
        hint: (h: string) => {
          call.hint = h;
          return chain;
        },
        sort: () => {
          call.sorted = true;
          return chain;
        },
        lean: () => chain,
        exec: async () => rows,
      };
      return chain;
    },
  } as unknown as Model<iCityModel>;
  return { model, calls };
}

const box = (w: number, s: number, e: number, n: number): AlertGeometry => ({
  type: "Polygon",
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

const city = (id: string, name: string, population?: number): Partial<iCityModel> => ({
  id,
  name,
  cc: "PL",
  lat: 52,
  lng: 21,
  population,
});

describe("citiesIn", () => {
  it("asks Mongo for the cities within the shape", async () => {
    const { model, calls } = mockCities([city("1", "Warsaw", 1_790_658)]);

    const out = await citiesIn(model, box(14, 49, 24, 55));

    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Warsaw");
    expect(calls[0].filter).toEqual({
      loc: { $geoWithin: { $geometry: box(14, 49, 24, 55) } },
    });
  });

  it("pins the geo index and sorts in memory, not in Mongo", async () => {
    // Letting the planner sort by population invites it to walk the population
    // index end-to-end — the slow query the `loc` index exists to replace.
    const { model, calls } = mockCities([
      city("1", "Radom", 211_371),
      city("2", "Warsaw", 1_790_658),
      city("3", "Przysucha", 6_000),
    ]);

    const out = await citiesIn(model, box(14, 49, 24, 55));

    expect(calls[0].hint).toBe("city_geo_ix");
    expect(calls[0].sorted).toBe(false);
    expect(out.map((c) => c.name)).toEqual(["Warsaw", "Radom", "Przysucha"]);
  });

  it("treats a city with no population as the smallest, not a crash", async () => {
    const { model } = mockCities([city("1", "Nowhere"), city("2", "Warsaw", 1_790_658)]);

    const out = await citiesIn(model, box(14, 49, 24, 55));

    expect(out.map((c) => c.name)).toEqual(["Warsaw", "Nowhere"]);
  });

  it("keeps only the fields a caption needs", async () => {
    const { model } = mockCities([
      { ...city("1", "Warsaw", 1_790_658), wikiExtract: "a very long article".repeat(500) },
    ]);

    const out = await citiesIn(model, box(14, 49, 24, 55));

    expect(Object.keys(out[0]).sort()).toEqual(["cc", "id", "lat", "lng", "name", "population"]);
  });

  it("never queries for a Point — it encloses nobody and $geoWithin rejects it", async () => {
    const { model, calls } = mockCities([city("1", "Warsaw", 1_790_658)]);

    const out = await citiesIn(model, { type: "Point", coordinates: [21, 52] } as AlertGeometry);

    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("attachCities", () => {
  it("annotates every blob and counts the placements", async () => {
    const { model } = mockCities([city("1", "Warsaw", 1_790_658), city("2", "Radom", 211_371)]);
    const blobs = [{ geometry: box(14, 49, 24, 55) }, { geometry: box(0, 0, 1, 1) }];

    const stats = await attachCities(model, blobs);

    expect(stats.cities).toBe(4); // two blobs, two cities each from the stub
    expect(blobs[0].cities?.map((c) => c.name)).toEqual(["Warsaw", "Radom"]);
  });

  it("counts blobs that cover nobody — open sea is normal, a spike is not", async () => {
    const { model } = mockCities([]);
    const blobs = [{ geometry: box(-40, 40, -30, 50) }];

    const stats = await attachCities(model, blobs);

    expect(stats).toMatchObject({ cities: 0, empty: 1, failures: 0 });
    expect(blobs[0].cities).toEqual([]);
  });

  it("a shape Mongo refuses costs that blob its cities, not the whole rebuild", async () => {
    const model = {
      find: (filter: { loc: { $geoWithin: { $geometry: AlertGeometry } } }) => {
        const bad = filter.loc.$geoWithin.$geometry.coordinates === ("bad" as never);
        const chain = {
          hint: () => chain,
          lean: () => chain,
          exec: async () => {
            if (bad) throw new Error("Can't extract geo keys");
            return [city("1", "Warsaw", 1_790_658)];
          },
        };
        return chain;
      },
    } as unknown as Model<iCityModel>;

    const blobs = [
      { geometry: { type: "Polygon", coordinates: "bad" } as unknown as AlertGeometry },
      { geometry: box(14, 49, 24, 55) },
    ];

    const stats = await attachCities(model, blobs);

    expect(stats).toMatchObject({ failures: 1, cities: 1 });
    expect(blobs[0].cities).toEqual([]);
    expect(blobs[1].cities?.[0].name).toBe("Warsaw"); // the run carried on
  });
});

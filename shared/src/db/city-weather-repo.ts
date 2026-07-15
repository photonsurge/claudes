import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iCityWeather, iCityWeatherModel } from "./city-weather-model";

const strip = (doc: any): iCityWeatherModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iCityWeatherModel;
};

/**
 * PURE: a Mongo lat/lng filter for cities inside `bbox` (`[west, south, east,
 * north]`), clamping latitude and splitting an antimeridian-wrapping box
 * (west > east) into an `$or` — the same rule the /api/cities route uses.
 * Exported for unit testing `topByBbox`'s geometry without a live collection.
 */
export function cityBboxQuery(bbox: [number, number, number, number]): Record<string, unknown> {
  const [w, s, e, n] = bbox;
  const q: Record<string, unknown> = { lat: { $gte: Math.max(s, -90), $lte: Math.min(n, 90) } };
  if (w <= e) q.lng = { $gte: w, $lte: e };
  else q.$or = [{ lng: { $gte: w } }, { lng: { $lte: e } }];
  return q;
}

/** CityWeather cache persistence — bulk upsert on `cityId`, read by id list. */
export function makeCityWeatherRepo(model: Model<iCityWeatherModel>) {
  return {
    model,

    async upsertMany(rows: Omit<iCityWeather, keyof { id?: string }>[]): Promise<{ upserted: number; matched: number }> {
      if (!rows.length) return { upserted: 0, matched: 0 };
      const ops = rows.map((r) => ({
        updateOne: {
          filter: { cityId: r.cityId },
          update: { $set: r, $setOnInsert: { id: uuidv4() } },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Weather for a set of cities (dossier / slide read), keyed by cityId. */
    async manyByCityIds(cityIds: string[]): Promise<iCityWeatherModel[]> {
      if (!cityIds.length) return [];
      const docs = await model.find({ cityId: { $in: cityIds } }).lean().exec();
      return docs.map(strip);
    },

    /**
     * Just "what's it doing there now, and next" for a set of cities.
     *
     * `manyByCityIds` also carries `hourly` — 24 points per city, for a trend
     * sparkline. That's the right read for a dossier about ONE place, and the
     * wrong one for a caller asking about every city under a warning, which can
     * be a thousand at once. Only the cities the worker caches (population ≥
     * CITY_POP_FLOOR) come back, so callers must treat a miss as normal.
     */
    async conditionsByCityIds(
      cityIds: string[],
    ): Promise<Pick<iCityWeather, "cityId" | "current" | "daily">[]> {
      if (!cityIds.length) return [];
      const docs = await model
        .find({ cityId: { $in: cityIds } }, { _id: 0, cityId: 1, current: 1, daily: 1 })
        .lean()
        .exec();
      return docs as unknown as Pick<iCityWeather, "cityId" | "current" | "daily">[];
    },

    /**
     * The `limit` biggest cities inside `bbox` (`[west, south, east, north]`),
     * population-ranked, each with its cached `current` + `daily` — the read
     * behind the on-air country/round-up "CITY CONDITIONS" slide. The cache
     * carries lat/lng/population, so this queries it directly (no City join).
     * Handles an antimeridian-wrapping box (west > east) like the cities route.
     */
    async topByBbox(
      bbox: [number, number, number, number],
      limit: number,
    ): Promise<iCityWeatherModel[]> {
      if (!bbox.every(Number.isFinite) || limit <= 0) return [];
      const docs = await model
        .find(cityBboxQuery(bbox))
        .sort({ population: -1 })
        .limit(Math.floor(limit))
        .lean()
        .exec();
      return docs.map(strip);
    },

    async get(cityId: string): Promise<iCityWeatherModel | null> {
      const doc = await model.findOne({ cityId }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /** Drop cached weather for cities no longer in `keep` (dropped below the
     *  population floor / removed on reseed). Empty `keep` is a no-op. */
    async pruneExcept(keep: string[]): Promise<{ removed: number }> {
      if (!keep.length) return { removed: 0 };
      const res = await model.deleteMany({ cityId: { $nin: keep } });
      return { removed: res.deletedCount ?? 0 };
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type CityWeatherRepo = ReturnType<typeof makeCityWeatherRepo>;

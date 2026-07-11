import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iCityWeather, iCityWeatherModel } from "./city-weather-model";

const strip = (doc: any): iCityWeatherModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iCityWeatherModel;
};

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
      const [w, s, e, n] = bbox;
      if (![w, s, e, n].every(Number.isFinite) || limit <= 0) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query: any = { lat: { $gte: Math.max(s, -90), $lte: Math.min(n, 90) } };
      if (w <= e) query.lng = { $gte: w, $lte: e };
      else query.$or = [{ lng: { $gte: w } }, { lng: { $lte: e } }];
      const docs = await model
        .find(query)
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

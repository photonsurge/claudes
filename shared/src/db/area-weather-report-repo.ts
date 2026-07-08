import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iAreaWeatherReport, iAreaWeatherReportModel, AreaPlaceKind } from "./area-weather-report-model";

const strip = (doc: any): iAreaWeatherReportModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iAreaWeatherReportModel;
};

/**
 * Area-weather report persistence + reads. `create` appends a fresh hourly
 * snapshot (history is the point — never overwrite); `latest` backs the admin
 * catalog's "current conditions" column. Mirrors `event-summary-repo.ts`.
 */
export function makeAreaWeatherReportRepo(model: Model<iAreaWeatherReportModel>) {
  return {
    model,

    async create(report: iAreaWeatherReport): Promise<iAreaWeatherReportModel> {
      const doc = await model.create({ id: uuidv4(), ...report });
      return strip(doc.toObject());
    },

    /** Newest report for one place, or null. */
    async latest(placeKind: AreaPlaceKind, placeId: string): Promise<iAreaWeatherReportModel | null> {
      const doc = await model.findOne({ placeKind, placeId }).sort({ generatedAt: -1 }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /** Newest report per place, across every place of `placeKind` — one Mongo round trip for the admin table. */
    async latestByKind(placeKind: AreaPlaceKind): Promise<iAreaWeatherReportModel[]> {
      // Sort order mirrors area_weather_place_gen_ix so the $group/$first turns
      // into a DISTINCT_SCAN: one index seek per place instead of sorting the
      // whole ever-growing history on every poll.
      const docs = await model
        .aggregate([
          { $match: { placeKind } },
          { $sort: { placeId: 1, generatedAt: -1 } },
          { $group: { _id: "$placeId", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
        ])
        .exec();
      return docs.map(strip);
    },

    /** History newest-first for one place. */
    async list(
      placeKind: AreaPlaceKind,
      placeId: string,
      opts: { limit?: number } = {},
    ): Promise<iAreaWeatherReportModel[]> {
      const docs = await model
        .find({ placeKind, placeId })
        .sort({ generatedAt: -1 })
        .limit(opts.limit ?? 20)
        .lean()
        .exec();
      return docs.map(strip);
    },
  };
}

export type AreaWeatherReportRepo = ReturnType<typeof makeAreaWeatherReportRepo>;

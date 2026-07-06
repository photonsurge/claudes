import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iWeatherForecastFrame, iWeatherForecastFrameModel } from "./weather-forecast-frame-model";

/** Forecast frame metadata without the texture bytes. */
export type WeatherForecastFrameMeta = Omit<iWeatherForecastFrameModel, "data">;

export interface ForecastFrameQuery {
  variable: string;
  /** Restrict to one source model; omit to get every model's frames. */
  model?: string;
}

/**
 * Decide whether an incoming frame should replace the stored one for the same
 * (model, variable, validTime): a NEWER run is always a better prediction of
 * that future moment than an older run, regardless of forecast hour — the
 * inverse of WeatherFrame's `frameShouldReplace`. Ties (same run re-publishing)
 * refresh in place. Pure.
 */
export function forecastShouldReplace(existingRun: Date, incomingRun: Date): boolean {
  return incomingRun.getTime() >= existingRun.getTime();
}

const variableQuery = (q: ForecastFrameQuery) => {
  const query: Record<string, unknown> = { variable: q.variable };
  if (q.model) query.model = q.model;
  return query;
};

/**
 * Rolling forecast-frame persistence. The worker upserts a frame per
 * (model, variable, validTime) after every ingest, newer run superseding
 * older; elapsed validTimes are pruned rather than retained forever.
 */
export function makeWeatherForecastFrameRepo(model: Model<iWeatherForecastFrameModel>) {
  return {
    model,

    /** Upsert on (model, variable, validTime); newer run wins over older. */
    async upsert(
      frame: Omit<iWeatherForecastFrame, keyof { id?: string }>,
    ): Promise<{ written: boolean }> {
      const key = { model: frame.model, variable: frame.variable, validTime: frame.validTime };
      const existing = await model.findOne(key).select({ run: 1 }).lean();
      if (existing && !forecastShouldReplace(existing.run, frame.run)) {
        return { written: false };
      }
      await model.updateOne(
        key,
        { $set: { ...frame }, $setOnInsert: { id: uuidv4() } },
        { upsert: true },
      );
      return { written: true };
    },

    /** Full frames (bytes included) for a variable, soonest validTime first. */
    async getSeries(q: ForecastFrameQuery): Promise<iWeatherForecastFrameModel[]> {
      return model
        .find(variableQuery(q))
        .sort({ validTime: 1 })
        .lean<iWeatherForecastFrameModel[]>();
    },

    /** Frame metadata only (no bytes) for a variable, soonest validTime first. */
    async listMeta(q: ForecastFrameQuery): Promise<WeatherForecastFrameMeta[]> {
      return model
        .find(variableQuery(q))
        .select({ data: 0 })
        .sort({ validTime: 1 })
        .lean<WeatherForecastFrameMeta[]>();
    },

    /** Distinct variables currently in the forecast store. */
    async variables(): Promise<string[]> {
      return model.distinct("variable");
    },

    /** Delete frames whose validTime has already passed `cutoff`; returns count. */
    async pruneOlderThan(cutoff: Date): Promise<number> {
      const res = await model.deleteMany({ validTime: { $lt: cutoff } });
      return res.deletedCount ?? 0;
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type WeatherForecastFrameRepo = ReturnType<typeof makeWeatherForecastFrameRepo>;

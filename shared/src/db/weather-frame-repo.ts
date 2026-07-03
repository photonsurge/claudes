import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iWeatherFrame, iWeatherFrameModel } from "./weather-frame-model";

/** Frame metadata without the texture bytes (listing / manifest use). */
export type WeatherFrameMeta = Omit<iWeatherFrameModel, "data">;

export interface FrameQuery {
  variable: string;
  /** Restrict to one source model; omit to get every model's frames. */
  model?: string;
  /** Inclusive validTime range. */
  from?: Date;
  to?: Date;
}

/**
 * Decide whether an incoming frame should replace the stored one for the same
 * (model, variable, validTime): a LOWER forecast hour is a fresher analysis of
 * the same moment, so it wins; ties refresh in place (re-bakes). Pure.
 */
export function frameShouldReplace(existingFhr: number, incomingFhr: number): boolean {
  return incomingFhr <= existingFhr;
}

const timeQuery = (q: FrameQuery) => {
  const query: Record<string, unknown> = { variable: q.variable };
  if (q.model) query.model = q.model;
  if (q.from || q.to) {
    const t: Record<string, Date> = {};
    if (q.from) t.$gte = q.from;
    if (q.to) t.$lte = q.to;
    query.validTime = t;
  }
  return query;
};

/**
 * Long-term frame archive persistence. The worker upserts a frame per
 * (model, variable, validTime) at publish/backfill time; the public history
 * routes read series (with bytes, for sampling) or metadata (for listings).
 */
export function makeWeatherFrameRepo(model: Model<iWeatherFrameModel>) {
  return {
    model,

    /** Upsert on (model, variable, validTime); lower fhr wins over higher. */
    async upsert(frame: Omit<iWeatherFrame, keyof { id?: string }>): Promise<{ written: boolean }> {
      const key = { model: frame.model, variable: frame.variable, validTime: frame.validTime };
      const existing = await model.findOne(key).select({ fhr: 1 }).lean();
      if (existing && !frameShouldReplace(existing.fhr, frame.fhr)) {
        return { written: false };
      }
      await model.updateOne(
        key,
        { $set: { ...frame }, $setOnInsert: { id: uuidv4() } },
        { upsert: true },
      );
      return { written: true };
    },

    /** Full frames (bytes included) in a validTime range, oldest first. */
    async getSeries(q: FrameQuery): Promise<iWeatherFrameModel[]> {
      return model.find(timeQuery(q)).sort({ validTime: 1 }).lean<iWeatherFrameModel[]>();
    },

    /** Frame metadata only (no bytes) in a validTime range, oldest first. */
    async listMeta(q: FrameQuery): Promise<WeatherFrameMeta[]> {
      return model
        .find(timeQuery(q))
        .select({ data: 0 })
        .sort({ validTime: 1 })
        .lean<WeatherFrameMeta[]>();
    },

    /** One frame by public id, bytes included. */
    async getByID(id: string): Promise<iWeatherFrameModel | null> {
      return model.findOne({ id }).lean<iWeatherFrameModel>();
    },

    /** Distinct variables present in the archive (for discovery endpoints). */
    async variables(): Promise<string[]> {
      return model.distinct("variable");
    },

    /** Delete frames with validTime older than `cutoff`; returns count. */
    async pruneOlderThan(cutoff: Date): Promise<number> {
      const res = await model.deleteMany({ validTime: { $lt: cutoff } });
      return res.deletedCount ?? 0;
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type WeatherFrameRepo = ReturnType<typeof makeWeatherFrameRepo>;

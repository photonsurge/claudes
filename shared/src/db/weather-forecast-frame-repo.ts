import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iWeatherForecastFrame, iWeatherForecastFrameModel } from "./weather-forecast-frame-model";
import type { BlobStore } from "./blob-store";

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
 *
 * Bytes live in a `WeatherForecastFrameData` sidecar (`blobs`), not inline, so
 * `listMeta` never pages textures through Mongo — see weather-frame-repo.ts and
 * blob-store.ts for the rationale.
 */
export function makeWeatherForecastFrameRepo(
  model: Model<iWeatherForecastFrameModel>,
  blobs: BlobStore,
) {
  return {
    model,
    blobs,

    /** Upsert on (model, variable, validTime); newer run wins over older. */
    async upsert(
      frame: Omit<iWeatherForecastFrame, keyof { id?: string }>,
    ): Promise<{ written: boolean }> {
      const key = { model: frame.model, variable: frame.variable, validTime: frame.validTime };
      const existing = await model.findOne(key).select({ id: 1, run: 1 }).lean();
      if (existing && !forecastShouldReplace(existing.run, frame.run)) {
        return { written: false };
      }
      const refId = existing?.id ?? uuidv4();
      const { data, ...meta } = frame;
      await model.updateOne(
        key,
        { $set: meta, $setOnInsert: { id: refId }, $unset: { data: "" } },
        { upsert: true },
      );
      await blobs.put(refId, data);
      return { written: true };
    },

    /** Full frames (bytes rejoined) for a variable, soonest validTime first. */
    async getSeries(q: ForecastFrameQuery): Promise<iWeatherForecastFrameModel[]> {
      const metas = await model
        .find(variableQuery(q))
        .sort({ validTime: 1 })
        .lean<iWeatherForecastFrameModel[]>();
      const byId = await blobs.getMany(metas.map((m) => m.id));
      return metas
        .map((m) => {
          const data = byId.get(m.id) ?? m.data; // fallback: legacy inline bytes
          return data ? { ...m, data } : null;
        })
        .filter((f): f is iWeatherForecastFrameModel => f !== null);
    },

    /** Frame metadata only (no bytes) for a variable, soonest validTime first. */
    async listMeta(q: ForecastFrameQuery): Promise<WeatherForecastFrameMeta[]> {
      return model
        .find(variableQuery(q))
        .select({ data: 0 })
        .sort({ validTime: 1 })
        .lean<WeatherForecastFrameMeta[]>();
    },

    /** One frame by public id, bytes rejoined; null if the frame or its bytes are gone. */
    async getByID(id: string): Promise<iWeatherForecastFrameModel | null> {
      const meta = await model.findOne({ id }).lean<iWeatherForecastFrameModel>();
      if (!meta) return null;
      const data = (await blobs.get(id)) ?? meta.data;
      return data ? { ...meta, data } : null;
    },

    /** Distinct variables currently in the forecast store. */
    async variables(): Promise<string[]> {
      return model.distinct("variable");
    },

    /** Delete frames whose validTime has already passed `cutoff` (and their bytes); returns count. */
    async pruneOlderThan(cutoff: Date): Promise<number> {
      const stale = await model
        .find({ validTime: { $lt: cutoff } })
        .select({ id: 1, _id: 0 })
        .lean<{ id: string }[]>();
      await blobs.delete(stale.map((s) => s.id));
      const res = await model.deleteMany({ validTime: { $lt: cutoff } });
      return res.deletedCount ?? 0;
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type WeatherForecastFrameRepo = ReturnType<typeof makeWeatherForecastFrameRepo>;

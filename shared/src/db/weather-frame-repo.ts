import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iWeatherFrame, iWeatherFrameModel } from "./weather-frame-model";
import type { BlobStore } from "./blob-store";

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
 *
 * The texture bytes live in a `WeatherFrameData` sidecar (`blobs`), NOT inline
 * on the metadata doc — so a `listMeta` scan never pages the never-pruned
 * binary archive through Mongo's cache. `getSeries`/`getByID` rejoin the bytes
 * by id; pre-migration rows that still carry `data` inline are read as a
 * fallback until the backfill moves and unsets them.
 */
export function makeWeatherFrameRepo(model: Model<iWeatherFrameModel>, blobs: BlobStore) {
  return {
    model,
    blobs,

    /** Upsert on (model, variable, validTime); lower fhr wins over higher. */
    async upsert(frame: Omit<iWeatherFrame, keyof { id?: string }>): Promise<{ written: boolean }> {
      const key = { model: frame.model, variable: frame.variable, validTime: frame.validTime };
      const existing = await model.findOne(key).select({ id: 1, fhr: 1 }).lean();
      if (existing && !frameShouldReplace(existing.fhr, frame.fhr)) {
        return { written: false };
      }
      const refId = existing?.id ?? uuidv4();
      const { data, ...meta } = frame;
      await model.updateOne(
        key,
        // Never write bytes inline; unset any legacy inline copy on re-bake.
        { $set: meta, $setOnInsert: { id: refId }, $unset: { data: "" } },
        { upsert: true },
      );
      await blobs.put(refId, data);
      return { written: true };
    },

    /** Full frames (bytes rejoined) in a validTime range, oldest first. */
    async getSeries(q: FrameQuery): Promise<iWeatherFrameModel[]> {
      const metas = await model.find(timeQuery(q)).sort({ validTime: 1 }).lean<iWeatherFrameModel[]>();
      const byId = await blobs.getMany(metas.map((m) => m.id));
      return metas
        .map((m) => {
          const data = byId.get(m.id) ?? m.data; // fallback: legacy inline bytes
          return data ? { ...m, data } : null;
        })
        .filter((f): f is iWeatherFrameModel => f !== null);
    },

    /** Frame metadata only (no bytes) in a validTime range, oldest first. */
    async listMeta(q: FrameQuery): Promise<WeatherFrameMeta[]> {
      return model
        .find(timeQuery(q))
        .select({ data: 0 })
        .sort({ validTime: 1 })
        .lean<WeatherFrameMeta[]>();
    },

    /** One frame by public id, bytes rejoined; null if the frame or its bytes are gone. */
    async getByID(id: string): Promise<iWeatherFrameModel | null> {
      const meta = await model.findOne({ id }).lean<iWeatherFrameModel>();
      if (!meta) return null;
      const data = (await blobs.get(id)) ?? meta.data; // fallback: legacy inline bytes
      return data ? { ...meta, data } : null;
    },

    /** Distinct variables present in the archive (for discovery endpoints). */
    async variables(): Promise<string[]> {
      return model.distinct("variable");
    },

    /** Delete frames with validTime older than `cutoff` (and their bytes); returns count. */
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

export type WeatherFrameRepo = ReturnType<typeof makeWeatherFrameRepo>;

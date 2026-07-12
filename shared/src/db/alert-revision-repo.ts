import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iAlertRevision, iAlertRevisionModel } from "./alert-revision-model";

const strip = (doc: any): iAlertRevision => {
  const { __v, _id, ...rest } = doc;
  return rest as iAlertRevision;
};

/** A revision to append — `id` and `seq` are assigned by the repo. */
export type NewAlertRevision = Omit<iAlertRevision, "id" | "created" | "updated" | "seq">;

/**
 * Append-only revision history for alerts. One writer (the worker ingest loop),
 * one reader (the admin detail page + the on-air focus bundle). `append` stamps
 * the next `seq` for the alert key; rows are never mutated.
 */
export function makeAlertRevisionRepo(model: Model<iAlertRevisionModel>) {
  return {
    model,

    /** Append a revision, assigning the next 1-based `seq` for `(source, identifier)`. */
    async append(rev: NewAlertRevision): Promise<iAlertRevision> {
      const seq = (await model.countDocuments({ source: rev.source, identifier: rev.identifier }).exec()) + 1;
      const doc = await model.create({ id: uuidv4(), seq, ...rev });
      return strip(doc.toObject());
    },

    /** All revisions for one alert, oldest-first (the raw material for the timeline). */
    async listForAlert(source: string, identifier: string): Promise<iAlertRevision[]> {
      const docs = await model.find({ source, identifier }).sort({ seq: 1 }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type AlertRevisionRepo = ReturnType<typeof makeAlertRevisionRepo>;

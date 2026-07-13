import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventSourceRevision, iEventSourceRevisionModel } from "./event-source-revision-model";

const strip = (doc: any): iEventSourceRevision => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventSourceRevision;
};

/** A revision to append — `id`/`seq` assigned by the repo. */
export type NewEventSourceRevision = Omit<iEventSourceRevision, "id" | "created" | "updated" | "seq">;

/**
 * Append-only source-revision history. `append` stamps the next `seq` for
 * `(eventId, source)`; rows are never mutated. One writer (the acquire job, only
 * when the payload hash moves), one reader (admin event detail).
 */
export function makeEventSourceRevisionRepo(model: Model<iEventSourceRevisionModel>) {
  return {
    model,

    async append(rev: NewEventSourceRevision): Promise<iEventSourceRevision> {
      const seq = (await model.countDocuments({ eventId: rev.eventId, source: rev.source }).exec()) + 1;
      const doc = await model.create({ id: uuidv4(), seq, ...rev });
      return strip(doc.toObject());
    },

    async listForEvent(eventId: string): Promise<iEventSourceRevision[]> {
      const docs = await model.find({ eventId }).sort({ source: 1, seq: 1 }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type EventSourceRevisionRepo = ReturnType<typeof makeEventSourceRevisionRepo>;

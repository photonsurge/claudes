import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventExternalLink, iEventExternalLinkModel } from "./event-external-link-model";
import type { MatchMethod } from "../events/types";

const strip = (doc: any): iEventExternalLink => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventExternalLink;
};

export interface UpsertLinkInput {
  eventId: string;
  source: string;
  externalId: string;
  matchMethod: MatchMethod;
  matchScore?: number;
}

/**
 * External-link store — the "we already matched this" ledger. `upsertLink` is
 * keyed on `(source, externalId)` so a given external record is only ever linked
 * to one event; `find` lets an adapter resolve an event by a source id without
 * re-matching.
 */
export function makeEventExternalLinkRepo(model: Model<iEventExternalLinkModel>) {
  return {
    model,

    async upsertLink(input: UpsertLinkInput): Promise<{ linked: boolean }> {
      const res = await model
        .updateOne(
          { source: input.source, externalId: input.externalId },
          {
            $set: {
              eventId: input.eventId,
              matchMethod: input.matchMethod,
              matchScore: input.matchScore,
            },
            $setOnInsert: { id: uuidv4(), linkedAt: new Date().toISOString() },
          },
          { upsert: true },
        )
        .exec();
      return { linked: (res.upsertedCount ?? 0) > 0 };
    },

    /** Resolve a link by the external source id, or null. */
    async find(source: string, externalId: string): Promise<iEventExternalLink | null> {
      const doc = await model.findOne({ source, externalId }).lean().exec();
      return doc ? strip(doc) : null;
    },

    async listForEvent(eventId: string): Promise<iEventExternalLink[]> {
      const docs = await model.find({ eventId }).sort({ linkedAt: 1 }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type EventExternalLinkRepo = ReturnType<typeof makeEventExternalLinkRepo>;

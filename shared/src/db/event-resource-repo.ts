import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iEventResource, iEventResourceModel } from "./event-resource-model";

const strip = (doc: any): iEventResource => {
  const { __v, _id, ...rest } = doc;
  return rest as iEventResource;
};

/** A resource to harvest — `id`/`discoveredAt`/`lastSeenAt` filled by the repo. */
export type NewEventResource = Omit<
  iEventResource,
  "id" | "created" | "updated" | "discoveredAt" | "lastSeenAt" | "rebroadcastSafe"
> & { rebroadcastSafe?: boolean };

/**
 * Harvested event resources. `upsertMany` dedups on `(eventId, source, url)` so
 * re-harvesting a source is idempotent (new resource inserts, seen one refreshes
 * `lastSeenAt`). Returns the ids so a follow-on render job can attach a preview.
 * Mirrors alert-resource's bulk upsert.
 */
export function makeEventResourceRepo(model: Model<iEventResourceModel>) {
  return {
    model,

    async upsertMany(resources: NewEventResource[]): Promise<{ upserted: number; matched: number }> {
      if (!resources.length) return { upserted: 0, matched: 0 };
      const now = new Date().toISOString();
      const ops = resources.map((r) => ({
        updateOne: {
          filter: { eventId: r.eventId, source: r.source, url: r.url },
          update: {
            $set: {
              kind: r.kind,
              title: r.title,
              description: r.description,
              mimeType: r.mimeType,
              sourceName: r.sourceName,
              attribution: r.attribution,
              license: r.license,
              rebroadcastSafe: r.rebroadcastSafe ?? false,
              contentHash: r.contentHash,
              assetId: r.assetId,
              lastSeenAt: now,
            },
            $setOnInsert: { id: uuidv4(), discoveredAt: now },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    async listForEvent(eventId: string): Promise<iEventResource[]> {
      const docs = await model.find({ eventId }).sort({ discoveredAt: 1 }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type EventResourceRepo = ReturnType<typeof makeEventResourceRepo>;

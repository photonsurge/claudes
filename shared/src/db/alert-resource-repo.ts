import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iAlertResource, iAlertResourceModel } from "./alert-resource-model";

const strip = (doc: any): iAlertResource => {
  const { __v, _id, ...rest } = doc;
  return rest as iAlertResource;
};

/** A resource to harvest — `id`/`harvestedAt` are filled by the repo. */
export type NewAlertResource = Omit<iAlertResource, "id" | "created" | "updated" | "harvestedAt"> & {
  harvestedAt?: Date;
};

/**
 * Harvested alert resources. `upsertMany` dedups on `(source, identifier, url)`
 * so re-harvesting the same feed is idempotent (a new resource inserts; a seen
 * one just refreshes its metadata). Mirrors fire-repo's bulk upsert.
 */
export function makeAlertResourceRepo(model: Model<iAlertResourceModel>) {
  return {
    model,

    async upsertMany(resources: NewAlertResource[]): Promise<{ upserted: number; matched: number }> {
      if (!resources.length) return { upserted: 0, matched: 0 };
      const harvestedAt = new Date();
      const ops = resources.map((r) => ({
        updateOne: {
          filter: { source: r.source, identifier: r.identifier, url: r.url },
          update: {
            $set: {
              alertId: r.alertId,
              mimeType: r.mimeType,
              kind: r.kind,
              description: r.description,
              harvestedAt: r.harvestedAt ?? harvestedAt,
            },
            $setOnInsert: { id: uuidv4() },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** All resources for one alert, oldest-first. */
    async listForAlert(source: string, identifier: string): Promise<iAlertResource[]> {
      const docs = await model.find({ source, identifier }).sort({ harvestedAt: 1 }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type AlertResourceRepo = ReturnType<typeof makeAlertResourceRepo>;

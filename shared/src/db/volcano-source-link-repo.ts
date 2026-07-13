import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iVolcanoSourceLink, iVolcanoSourceLinkModel, VolcanoLinkMatchMethod } from "./volcano-source-link-model";

const strip = (doc: any): iVolcanoSourceLink => {
  const { __v, _id, ...rest } = doc;
  return rest as iVolcanoSourceLink;
};

export interface UpsertVolcanoLinkInput {
  volcanoId: string;
  source: string;
  externalId: string;
  externalCode?: string;
  externalUrl?: string;
  matchMethod: VolcanoLinkMatchMethod;
  matchScore?: number;
}

/**
 * The volcano crosswalk ledger. `upsert` is keyed on `(source, externalId)` so a
 * source's own volcano id maps to exactly one canonical `gvp:` volcano; `find`
 * resolves it back on the next poll without re-matching.
 */
export function makeVolcanoSourceLinkRepo(model: Model<iVolcanoSourceLinkModel>) {
  return {
    model,

    async upsert(input: UpsertVolcanoLinkInput): Promise<{ created: boolean }> {
      const res = await model
        .updateOne(
          { source: input.source, externalId: input.externalId },
          {
            $set: {
              volcanoId: input.volcanoId,
              externalCode: input.externalCode,
              externalUrl: input.externalUrl,
              matchMethod: input.matchMethod,
              matchScore: input.matchScore,
            },
            $setOnInsert: { id: uuidv4(), enabled: true, linkedAt: new Date().toISOString() },
          },
          { upsert: true },
        )
        .exec();
      return { created: (res.upsertedCount ?? 0) > 0 };
    },

    /** Resolve a link by the source's own id, or null. */
    async find(source: string, externalId: string): Promise<iVolcanoSourceLink | null> {
      const doc = await model.findOne({ source, externalId, enabled: true }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /** Every stored link for one volcano (for the admin dossier / debugging). */
    async listForVolcano(volcanoId: string): Promise<iVolcanoSourceLink[]> {
      const docs = await model.find({ volcanoId }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type VolcanoSourceLinkRepo = ReturnType<typeof makeVolcanoSourceLinkRepo>;

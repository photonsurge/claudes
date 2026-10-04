import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iPlaceRoundup, iPlaceRoundupModel } from "./place-roundup-model";

const strip = (doc: any): iPlaceRoundupModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iPlaceRoundupModel;
};

/**
 * Per-place round-up persistence + reads, instantiated once per collection
 * (`countryRoundups` / `regionRoundups`). `create` appends a fresh round-up
 * (history is the point — never overwrite); `latestForPlace` backs both the
 * continuity call (the worker feeds it back to the LLM) and the admin "current"
 * view; `latestPerPlace` powers the admin index. Mirrors `event-summary-repo`.
 */
export function makePlaceRoundupRepo(model: Model<iPlaceRoundupModel>) {
  return {
    model,

    /** Append a fresh round-up. */
    async create(roundup: iPlaceRoundup): Promise<iPlaceRoundupModel> {
      const doc = await model.create({ id: uuidv4(), ...roundup });
      return strip(doc.toObject());
    },

    /** Round-ups generated after `sinceMs`, oldest first (the director's fresh-event watch). */
    async generatedSince(sinceMs: number, opts: { limit?: number } = {}): Promise<iPlaceRoundupModel[]> {
      const docs = await model
        .find({ generatedAt: { $gt: new Date(sinceMs) } }, { placeKind: 1, placeId: 1, name: 1, generatedAt: 1, narrativeStatus: 1, id: 1 })
        .sort({ generatedAt: 1 })
        .limit(opts.limit ?? 100)
        .lean()
        .exec();
      return docs.map(strip);
    },

    /** Newest round-up for one place, or null (the continuity source). */
    async latestForPlace(placeId: string): Promise<iPlaceRoundupModel | null> {
      const doc = await model.findOne({ placeId }).sort({ generatedAt: -1 }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /** Newest round-up per place across the whole collection — one round trip for the admin index. */
    async latestPerPlace(): Promise<iPlaceRoundupModel[]> {
      // Sort mirrors place_roundup_place_gen_ix so $group/$first is a DISTINCT_SCAN
      // (one index seek per place) rather than sorting the whole history each poll.
      const docs = await model
        .aggregate([
          { $sort: { placeId: 1, generatedAt: -1 } },
          { $group: { _id: "$placeId", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
          { $sort: { name: 1 } },
        ])
        .exec();
      return docs.map(strip);
    },

    /** History newest-first for one place. */
    async list(placeId: string, opts: { limit?: number } = {}): Promise<iPlaceRoundupModel[]> {
      const docs = await model
        .find({ placeId })
        .sort({ generatedAt: -1 })
        .limit(opts.limit ?? 20)
        .lean()
        .exec();
      return docs.map(strip);
    },
  };
}

export type PlaceRoundupRepo = ReturnType<typeof makePlaceRoundupRepo>;

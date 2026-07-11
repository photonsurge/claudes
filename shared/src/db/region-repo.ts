import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iRegion, iRegionModel, iRegionCountry, iRegionCity } from "./region-model";

const strip = (doc: any): iRegionModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iRegionModel;
};

/** Region catalog persistence — mirrors `country-repo.ts` minus the geometry concern. */
export function makeRegionRepo(model: Model<iRegionModel>) {
  return {
    model,

    async upsertMany(
      regions: Pick<iRegion, "regionId" | "name" | "group" | "bbox">[],
    ): Promise<{ upserted: number; matched: number }> {
      if (!regions.length) return { upserted: 0, matched: 0 };
      const ops = regions.map((r) => ({
        updateOne: {
          filter: { regionId: r.regionId },
          update: {
            $set: { name: r.name, group: r.group, bbox: r.bbox },
            $setOnInsert: { id: uuidv4() },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Drop any region whose `regionId` isn't in `keep` — reconciles the catalog
     *  to the current `REGION_PRESETS` on reseed, so entries deleted from the
     *  seed (e.g. a dropped "Key countries" group) don't linger in Mongo. Empty
     *  `keep` is a no-op: never wipe the whole catalog on an empty/failed seed. */
    async pruneExcept(keep: string[]): Promise<{ removed: number }> {
      if (!keep.length) return { removed: 0 };
      const res = await model.deleteMany({ regionId: { $nin: keep } });
      return { removed: res.deletedCount ?? 0 };
    },

    /** Every region, catalog (declared) order. Small bounded set — no cap. */
    async list(): Promise<iRegionModel[]> {
      const docs = await model.find({}).lean().exec();
      return docs.map(strip);
    },

    async get(regionId: string): Promise<iRegionModel | null> {
      const doc = await model.findOne({ regionId }).lean().exec();
      return doc ? strip(doc) : null;
    },

    async listNeedingEnrichment(staleBefore: Date, force = false): Promise<iRegionModel[]> {
      const q = force ? {} : { wikiFetchedAt: { $not: { $gt: staleBefore } } };
      const docs = await model.find(q).lean().exec();
      return docs.map(strip);
    },

    async updateEnrichment(
      regionId: string,
      patch: {
        wikiTitle?: string;
        wikiThumb?: string;
        wikiPhoto?: string;
        wikiExtract?: string;
        wikiGallery?: string[];
        wikiFetchedAt?: Date;
      },
    ): Promise<void> {
      await model.updateOne({ regionId }, { $set: patch }).exec();
    },

    /** Store the recomputed places dossier (member countries + biggest cities). */
    async updatePlaces(
      regionId: string,
      patch: { countries?: iRegionCountry[]; topCities?: iRegionCity[]; placesFetchedAt?: Date },
    ): Promise<void> {
      await model.updateOne({ regionId }, { $set: patch }).exec();
    },
  };
}

export type RegionRepo = ReturnType<typeof makeRegionRepo>;

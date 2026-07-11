import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iCountry, iCountryModel } from "./country-model";

const strip = (doc: any): iCountryModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iCountryModel;
};

/**
 * Country catalog persistence: `upsertMany` seeds/refreshes from the Natural
 * Earth source (`worker/src/scripts/seedCountries.ts`), everything else backs
 * the admin catalog + enrichment job. Mirrors `volcano-repo.ts`'s shape.
 */
export function makeCountryRepo(model: Model<iCountryModel>) {
  return {
    model,

    /** Upsert the full catalog on `countryId`, preserving any existing enrichment fields. */
    async upsertMany(
      countries: Pick<iCountry, "countryId" | "name" | "iso2" | "iso3" | "continent" | "subregion" | "bbox" | "geometry">[],
    ): Promise<{ upserted: number; matched: number }> {
      if (!countries.length) return { upserted: 0, matched: 0 };
      const ops = countries.map((c) => ({
        updateOne: {
          filter: { countryId: c.countryId },
          update: {
            $set: {
              name: c.name,
              iso2: c.iso2,
              iso3: c.iso3,
              continent: c.continent,
              subregion: c.subregion,
              bbox: c.bbox,
              geometry: c.geometry,
            },
            $setOnInsert: { id: uuidv4() },
          },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Every country, name-sorted. No cap — this is a bounded ~240-row catalog. */
    async list(): Promise<iCountryModel[]> {
      const docs = await model.find({}).sort({ name: 1 }).lean().exec();
      return docs.map(strip);
    },

    async get(countryId: string): Promise<iCountryModel | null> {
      const doc = await model.findOne({ countryId }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /** Countries opted in to 12h AI round-ups, name-sorted (the round-up job's work-list). */
    async listRoundupEnabled(): Promise<iCountryModel[]> {
      const docs = await model.find({ roundupEnabled: true }).sort({ name: 1 }).lean().exec();
      return docs.map(strip);
    },

    /** Flip a country's round-up opt-in (the /countries admin toggle). */
    async setRoundupEnabled(countryId: string, enabled: boolean): Promise<void> {
      await model.updateOne({ countryId }, { $set: { roundupEnabled: enabled } }).exec();
    },

    /** Countries whose Wikipedia enrichment is missing or older than `staleBefore` (unless `force`). */
    async listNeedingEnrichment(staleBefore: Date, force = false): Promise<iCountryModel[]> {
      const q = force ? {} : { wikiFetchedAt: { $not: { $gt: staleBefore } } };
      const docs = await model.find(q).lean().exec();
      return docs.map(strip);
    },

    /** Patch Wikipedia/Wikidata enrichment fields onto one country by its `countryId`. */
    async updateEnrichment(
      countryId: string,
      patch: {
        wikiTitle?: string;
        wikiThumb?: string;
        wikiPhoto?: string;
        wikiExtract?: string;
        wikiGallery?: string[];
        wikiFetchedAt?: Date;
        population?: number;
        capital?: string;
        currency?: string;
      },
    ): Promise<void> {
      await model.updateOne({ countryId }, { $set: patch }).exec();
    },
  };
}

export type CountryRepo = ReturnType<typeof makeCountryRepo>;

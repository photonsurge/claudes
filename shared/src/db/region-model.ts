import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { RegionGroupId } from "../regions";

/**
 * Named regions that aren't single countries — oceans, continents, EU blocs,
 * the UK's constituent nations — seeded from the curated `REGION_PRESETS`
 * (`shared/src/regions.ts`) via `yarn seed:regions`. bbox-only (no polygon):
 * these aren't landmasses with a real boundary, so area-weather stats for a
 * region are a plain bbox average, unlike the polygon-masked Country catalog.
 */
export interface iRegion extends iGeneralModel {
  /** Matches the id in REGION_PRESETS — stable seed/upsert key. */
  regionId: string;
  name: string;
  group: RegionGroupId;
  bbox: [number, number, number, number];
  /** Wikipedia enrichment (see worker/src/jobs/regions.ts). */
  wikiTitle?: string;
  wikiThumb?: string;
  wikiPhoto?: string;
  wikiExtract?: string;
  wikiGallery?: string[];
  wikiFetchedAt?: Date;
}

export interface iRegionModel extends iRegion {
  id: string;
  _id: string;
}

const RegionSchema = new mongoose.Schema<iRegionModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    regionId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    group: { type: String, required: true },
    bbox: { type: [Number], required: true },
    wikiTitle: { type: String, required: false },
    wikiThumb: { type: String, required: false },
    wikiPhoto: { type: String, required: false },
    wikiExtract: { type: String, required: false },
    wikiGallery: { type: [String], required: false },
    wikiFetchedAt: { type: Date, required: false },
  },
  { timestamps: false },
);

RegionSchema.index({ regionId: 1 }, { unique: true, name: "region_id_ix" });

export const getRegionModel = (conn: Connection) =>
  getModel<iRegionModel>(conn, "Region", RegionSchema);

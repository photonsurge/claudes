import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/** A city placed on the globe. Curated in /cities, rendered on /watch. */
export interface iCity extends iGeneralModel {
  name: string;
  /** Country display name. */
  country?: string;
  /** ISO-3166 alpha-2 country code. */
  cc?: string;
  /** Admin-1 region/state name. */
  region?: string;
  lat: number;
  lng: number;
  population?: number;
  isCapital?: boolean;
  /**
   * Prominence rank (Natural Earth SCALERANK: 0 = most prominent). Lower shows
   * at lower zooms — drives level-of-detail filtering for overlays.
   */
  rank?: number;
  /**
   * Cached Wikipedia enrichment (worker-populated via `yarn enrich:wiki`) so the
   * public broadcast overlay can show a photo + blurb for cities near an on-air
   * event without ever calling Wikipedia at request time.
   */
  wikiTitle?: string;
  /** Thumbnail image URL from the Wikipedia REST summary. */
  wikiThumb?: string;
  /** Short plain-text extract (first paragraph) from the Wikipedia summary. */
  wikiExtract?: string;
  /** When the worker last fetched Wikipedia for this city. */
  wikiFetchedAt?: Date;
}

export interface iCityModel extends iCity {
  id: string;
  _id: string;
}

const CitySchema = new mongoose.Schema<iCityModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    country: { type: String, required: false, trim: true, maxlength: 120 },
    cc: { type: String, required: false, trim: true, maxlength: 4 },
    region: { type: String, required: false, trim: true, maxlength: 160 },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    population: { type: Number, required: false, min: 0, default: 0 },
    isCapital: { type: Boolean, required: false, default: false },
    rank: { type: Number, required: false, default: 10 },
    wikiTitle: { type: String, required: false, trim: true, maxlength: 200 },
    wikiThumb: { type: String, required: false, trim: true, maxlength: 600 },
    wikiExtract: { type: String, required: false, trim: true, maxlength: 2000 },
    wikiFetchedAt: { type: Date, required: false },
  },
  mongoTimestamps,
);

CitySchema.index({ name: 1 }, { name: "city_name_ix" });
CitySchema.index({ population: -1 }, { name: "city_population_ix" });
CitySchema.index({ rank: 1, population: -1 }, { name: "city_rank_pop_ix" });

export const getCityModel = (conn: Connection) => getModel<iCityModel>(conn, "City", CitySchema);

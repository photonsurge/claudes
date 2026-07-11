import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { RegionGroupId } from "../regions";

/** A member country of a land region — curated relation (see region-membership),
 *  enriched at `regions.enrichPlaces` time with a rough size proxy from cities. */
export interface iRegionCountry {
  /** ISO-3166 alpha-2, lowercase. */
  cc: string;
  name: string;
  /** How many of our cities fall in this country within the region. */
  cityCount: number;
  /** The country's biggest city within the region (label helper). */
  topCity?: string;
  /** Summed population of our in-region cities for this country (presence proxy). */
  population?: number;
}

/** A biggest-city entry stored on a land region for the dossier / slides. */
export interface iRegionCity {
  /** City.id — join key into the CityWeather cache. */
  cityId?: string;
  name: string;
  country?: string;
  /** ISO-3166 alpha-2 (as stored on the City). */
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
}

/**
 * Named regions for camera framing — oceans, continents, and sub-continental
 * regions (plus the UK as the one pinned country) — seeded from `REGION_PRESETS`
 * (`shared/src/regions.ts`) via `yarn seed:regions`. bbox-only (no polygon):
 * these aren't landmasses with a real boundary, so area-weather stats for a
 * region are a plain bbox average, unlike the polygon-masked Country catalog.
 *
 * Land regions also carry a curated PLACES dossier — the countries within them
 * and their biggest cities (`regions.enrichPlaces`) — so broadcast slides can
 * read `countries`/`topCities` straight off the doc. Oceans get none of it.
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
  /** Curated member countries (land regions only). See region-membership.ts. */
  countries?: iRegionCountry[];
  /** Biggest cities within the region, population-ranked (land regions only). */
  topCities?: iRegionCity[];
  /** When `regions.enrichPlaces` last recomputed countries/topCities. */
  placesFetchedAt?: Date;
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
    countries: {
      type: [
        new mongoose.Schema<iRegionCountry>(
          {
            cc: { type: String, required: true },
            name: { type: String, required: true },
            cityCount: { type: Number, required: true, default: 0 },
            topCity: { type: String, required: false },
            population: { type: Number, required: false },
          },
          { _id: false },
        ),
      ],
      required: false,
    },
    topCities: {
      type: [
        new mongoose.Schema<iRegionCity>(
          {
            cityId: { type: String, required: false },
            name: { type: String, required: true },
            country: { type: String, required: false },
            cc: { type: String, required: false },
            lat: { type: Number, required: true },
            lng: { type: Number, required: true },
            population: { type: Number, required: false },
          },
          { _id: false },
        ),
      ],
      required: false,
    },
    placesFetchedAt: { type: Date, required: false },
  },
  { timestamps: false },
);

RegionSchema.index({ regionId: 1 }, { unique: true, name: "region_id_ix" });

export const getRegionModel = (conn: Connection) =>
  getModel<iRegionModel>(conn, "Region", RegionSchema);

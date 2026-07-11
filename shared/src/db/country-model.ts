import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * The full ~240-country catalog (Natural Earth admin-0, `public/public/data/
 * countries.geojson`), seeded once via `yarn seed:countries` — unlike the
 * static `countries.generated.ts` bbox table (a lightweight lookup baked at
 * build time for the region picker), this is a Mongo-backed catalog that
 * carries real (simplified) boundary geometry for polygon-accurate
 * area-weather stats, plus Wikipedia/Wikidata enrichment.
 */
export interface iCountry extends iGeneralModel {
  /** ISO 3166-1 alpha-2 lowercased, else a name slug — stable seed/upsert key. */
  countryId: string;
  name: string;
  iso2?: string;
  iso3?: string;
  continent?: string;
  subregion?: string;
  /** [west, south, east, north] over the WHOLE country's real geometry (every
   *  island/territory) — deliberately NOT the same "biggest ring only"
   *  convention as the camera-framing countries.generated.ts, since an
   *  archipelago nation's area-weather stats need to cover all its territory. */
  bbox: [number, number, number, number];
  /** Simplified (Douglas–Peucker) MultiPolygon over every ring of every merged
   *  feature — the area-weather job's polygon mask (geo/pointInPolygon.ts). */
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: any };
  /** Wikipedia enrichment (see worker/src/jobs/countries.ts). */
  wikiTitle?: string;
  wikiThumb?: string;
  wikiPhoto?: string;
  wikiExtract?: string;
  wikiGallery?: string[];
  wikiFetchedAt?: Date;
  population?: number;
  capital?: string;
  currency?: string;
  /** Opt-in flag: generate a 12h AI round-up for this country (default off —
   *  toggled from the /countries admin table). Regions always generate. */
  roundupEnabled?: boolean;
}

export interface iCountryModel extends iCountry {
  id: string;
  _id: string;
}

const CountrySchema = new mongoose.Schema<iCountryModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    countryId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    iso2: { type: String, required: false },
    iso3: { type: String, required: false },
    continent: { type: String, required: false },
    subregion: { type: String, required: false },
    bbox: { type: [Number], required: true },
    geometry: { type: mongoose.Schema.Types.Mixed, required: true },
    wikiTitle: { type: String, required: false },
    wikiThumb: { type: String, required: false },
    wikiPhoto: { type: String, required: false },
    wikiExtract: { type: String, required: false },
    wikiGallery: { type: [String], required: false },
    wikiFetchedAt: { type: Date, required: false },
    population: { type: Number, required: false },
    capital: { type: String, required: false },
    currency: { type: String, required: false },
    roundupEnabled: { type: Boolean, required: false, default: false },
  },
  { timestamps: false },
);

CountrySchema.index({ countryId: 1 }, { unique: true, name: "country_id_ix" });
// No 2dsphere index: MongoDB enforces strict simple-polygon GeoJSON (no
// self-intersecting rings), which Douglas–Peucker simplification doesn't
// guarantee for small/complex coastlines. `geometry` is only ever read by
// the in-process `pointInPolygon` ray-cast (geo/pointInPolygon.ts), which
// tolerates the rare minor artifact fine for area-weather masking purposes —
// add the index later if a real Mongo geo-query need shows up.

export const getCountryModel = (conn: Connection) =>
  getModel<iCountryModel>(conn, "Country", CountrySchema);

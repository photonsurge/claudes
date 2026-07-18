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
  /**
   * Precomputed camera-tour dossier for the `country` spotlight, built by the
   * worker (`countries.computeTours`) from this country's OWN cities (queried by
   * `cc`, never a coarse bbox). The director flies a real spread-out tour instead
   * of holding one hand-tuned frame — see shared/src/director-country-tour.ts.
   * `tourCentroid` is the population-weighted "middle" (the establishing shot the
   * tour starts on); `tourCities` are the biggest city per compass sector, ordered
   * clockwise from north; `tourFrame` frames the whole set. Absent until computed.
   */
  tourCentroid?: [number, number];
  tourCities?: iCountryTourCity[];
  tourFrame?: { center: [number, number]; zoom: number };
  /** When `countries.computeTours` last recomputed the tour dossier. */
  tourComputedAt?: Date;
}

/** One city on a country's precomputed spotlight tour (director-country-tour.ts). */
export interface iCountryTourCity {
  /** City.id — join key into the CityWeather cache / focus bundle. */
  cityId?: string;
  name: string;
  /** ISO-3166 alpha-2 (as stored on the City). */
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
  /** The compass sector (0=N, 1=NE … 7=NW around the centroid) this city
   *  represents — kept for debugging/inspection, not read on air. */
  sector?: number;
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
    // Precomputed spotlight tour (countries.computeTours). Fixed-length coord
    // pairs stored as plain [Number]; the city list is a typed subdoc array.
    tourCentroid: { type: [Number], required: false },
    tourCities: {
      type: [
        new mongoose.Schema<iCountryTourCity>(
          {
            cityId: { type: String, required: false },
            name: { type: String, required: true },
            cc: { type: String, required: false },
            lat: { type: Number, required: true },
            lng: { type: Number, required: true },
            population: { type: Number, required: false },
            sector: { type: Number, required: false },
          },
          { _id: false },
        ),
      ],
      required: false,
    },
    tourFrame: {
      type: new mongoose.Schema<{ center: [number, number]; zoom: number }>(
        {
          center: { type: [Number], required: true },
          zoom: { type: Number, required: true },
        },
        { _id: false },
      ),
      required: false,
    },
    tourComputedAt: { type: Date, required: false },
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

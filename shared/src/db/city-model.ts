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
  /**
   * GeoJSON mirror of [lng, lat], indexed 2dsphere so "cities in this box"
   * lookups hit the geospatial index instead of walking the population index
   * end-to-end. Kept in sync with lat/lng by the pre-save hook (single-doc
   * writes) and set directly by the GeoNames seed parser (bulk insertMany).
   */
  loc?: { type: "Point"; coordinates: [number, number] };
  population?: number;
  isCapital?: boolean;
  /**
   * IANA zone id from the GeoNames gazetteer ("Asia/Tokyo") — the source of the
   * on-air "local time here" reading (see shared/src/time/local-zone.ts). Real
   * zones survive DST and the half-hour offsets a longitude guess gets wrong.
   * Reseeds set it from the dump; docs seeded before the field existed are
   * filled by the `cities.backfillTimezones` job.
   */
  timezone?: string;
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
  /** Full-resolution version of the same lead image. */
  wikiPhoto?: string;
  /** Plain-text intro extract from Wikipedia (several paragraphs where available). */
  wikiExtract?: string;
  /** Extra article images beyond the lead photo. */
  wikiGallery?: string[];
  /** When the worker last fetched Wikipedia for this city. */
  wikiFetchedAt?: Date;
  /** Wikidata founding/inception year. */
  foundedYear?: number;
  /** Wikidata area, square kilometres. */
  areaKm2?: number;
  /** Wikidata elevation above sea level, metres. */
  elevationM?: number;
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
    loc: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number] },
    },
    population: { type: Number, required: false, min: 0, default: 0 },
    isCapital: { type: Boolean, required: false, default: false },
    timezone: { type: String, required: false, trim: true, maxlength: 64 },
    rank: { type: Number, required: false, default: 10 },
    wikiTitle: { type: String, required: false, trim: true, maxlength: 200 },
    wikiThumb: { type: String, required: false, trim: true, maxlength: 600 },
    wikiPhoto: { type: String, required: false, trim: true, maxlength: 600 },
    wikiExtract: { type: String, required: false, trim: true, maxlength: 4000 },
    wikiGallery: { type: [String], required: false },
    wikiFetchedAt: { type: Date, required: false },
    foundedYear: { type: Number, required: false },
    areaKm2: { type: Number, required: false },
    elevationM: { type: Number, required: false },
  },
  mongoTimestamps,
);

CitySchema.index({ name: 1 }, { name: "city_name_ix" });
CitySchema.index({ population: -1 }, { name: "city_population_ix" });
CitySchema.index({ rank: 1, population: -1 }, { name: "city_rank_pop_ix" });
CitySchema.index({ loc: "2dsphere" }, { name: "city_geo_ix", sparse: true });
// NB: the on-air local clock's "nearest city that knows its timezone" lookup
// rides this SAME index — it reads the nearest handful in distance order and
// takes the first with a zone, rather than adding a second 2dsphere index on
// `loc` (Mongo rejects a duplicate key pattern that differs only in options).

// Keep the 2dsphere `loc` in step with lat/lng on single-doc writes (POST
// /api/cities, admin edits — model.create/.save run this). The bulk GeoNames
// seed uses insertMany, which bypasses save hooks, so the parser sets `loc`
// itself; existing pre-field docs are filled by the `cities.backfillLoc` job.
CitySchema.pre("save", function (next) {
  if (Number.isFinite(this.lng) && Number.isFinite(this.lat)) {
    this.loc = { type: "Point", coordinates: [this.lng, this.lat] };
  }
  next();
});

/**
 * A `$geoWithin` box filter for the `loc` 2dsphere index — the replacement for
 * the old `lat/lng $gte/$lte` (+ `$or` seam split) scans that, with no geo
 * index, walked the population index end-to-end for sparse/low-population boxes.
 *
 * The box `[w,s]→[e,n]` is sliced along longitude into ≤120°-wide pieces, each
 * clipped at the ±180 seam, so every emitted ring is a well-formed CCW box
 * narrower than a hemisphere (2dsphere reads a wider edge as the long way round,
 * and a naïve full-world ring collapses to zero width). One slice ⇒ Polygon,
 * many ⇒ MultiPolygon. Handles small, antimeridian-wrapping, and whole-world
 * boxes uniformly; latitudes clamp to ±90.
 */
export function cityGeoWithinBox(w: number, s: number, e: number, n: number): Record<string, unknown> {
  const south = Math.max(-90, Math.min(90, Math.min(s, n)));
  const north = Math.max(-90, Math.min(90, Math.max(s, n)));
  // Wrap any real longitude into [-180, 180) — so +180 maps to the -180 seam.
  const wrap = (l: number) => {
    const x = ((l % 360) + 360) % 360;
    return x >= 180 ? x - 360 : x;
  };
  // Requested span (0, 360], measured from the raw inputs so a full-world / very
  // wide box is caught before endpoints collapse onto the same meridian.
  let span = (((e - w) % 360) + 360) % 360;
  if (span < 1e-9) span = 360;

  const ring = (a: number, b: number): [number, number][] => [
    [a, south],
    [b, south],
    [b, north],
    [a, north],
    [a, south],
  ];

  const rings: [number, number][][] = [];
  let cursor = ((w % 360) + 360) % 360; // continuous forward walk from the west edge
  let remaining = span;
  for (let guard = 0; remaining > 1e-9 && guard < 64; guard++) {
    const a = wrap(cursor);
    const distToSeam = 180 - a; // a ∈ [-180, 180) ⇒ always > 0
    const seg = Math.min(120, remaining, distToSeam);
    rings.push(ring(a, a + seg));
    cursor += seg;
    remaining -= seg;
  }

  if (rings.length === 1) {
    return { $geoWithin: { $geometry: { type: "Polygon", coordinates: [rings[0]] } } };
  }
  return { $geoWithin: { $geometry: { type: "MultiPolygon", coordinates: rings.map((r) => [r]) } } };
}

export const getCityModel = (conn: Connection) => getModel<iCityModel>(conn, "City", CitySchema);

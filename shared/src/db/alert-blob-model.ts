import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { AlertGeometry, SeverityRank } from "./alert-model";

/**
 * A dissolved warning area: one shape covering every touching alert area of the
 * same hazard and severity.
 *
 * MeteoAlarm issues one alert per county, so the globe drew hundreds of little
 * squares where a viewer should see a few weather blobs. The worker unions them
 * and caches the result here; `public` reads the shape and draws it, doing no
 * clipping itself (the library is worker-only, deliberately).
 *
 * Pure derived cache — the member alerts remain the source of truth, and the
 * whole set is REPLACED on each rebuild rather than updated in place, because a
 * blob's identity is its geometry and that changes as alerts come and go.
 */
/**
 * A city standing inside a blob, denormalised onto it.
 *
 * Deliberately a copy, not a reference: the whole point is that a reader asking
 * "who is under this warning" gets an answer with no second query and no
 * point-in-polygon of its own. The fields are the ones a caption needs — - name,
 * where, and how big — and nothing else, because this array rides along with a
 * geometry that already dwarfs it.
 */
export interface iBlobCity {
  id: string;
  name: string;
  /** ISO-3166 alpha-2, for "Kraków, PL" style captions. */
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
}

export interface iAlertBlob extends iGeneralModel {
  /** Hazard bucket the members share ("Thunderstorm"). */
  hazard: string;
  severityRank: SeverityRank;
  /**
   * ISO-3166 alpha-2 every member shares — part of the bucket key, so a blob
   * never crosses a national border. Undefined only for feeds that carry no
   * country in their identifier (GDACS).
   *
   * Warnings are issued BY a country and a blob gets ONE representative card, so
   * without this seam the card lied: a single thunderstorm shape once spanned
   * thirteen countries from Spain to Kosovo and quoted one of them for all of it.
   */
  country?: string;
  geometry: AlertGeometry;
  /**
   * `[w, s, e, n]` bounds of `geometry`.
   *
   * The camera asks "which shapes are in view", and this lets it ask WITHOUT the
   * geometry — a plain numeric compare instead of loading a million vertices to
   * discover the shape was off-screen anyway.
   */
  bbox: [number, number, number, number];
  /** Alert ids that went into this shape — panels still list them individually. */
  memberIds: string[];
  /**
   * Every city inside `geometry`, biggest first — resolved by the worker at
   * rebuild time so nothing downstream repeats the work.
   *
   * This is the question every consumer of a blob actually asks ("which places
   * is this warning over?"), and it's the expensive one: a point-in-polygon
   * against a dissolved multi-country shape, per cut, on the broadcast surface.
   * The blob is already a rebuilt-from-scratch cache, so the answer costs one
   * indexed query per shape here and zero everywhere else.
   */
  cities: iBlobCity[];
  builtAt: Date;
  /**
   * This shape belongs to the generation currently ON AIR.
   *
   * A rebuild streams its shapes out over ~2 minutes and can't be atomic, so
   * there are always two generations in flight. Readers must see exactly one of
   * them — every read filters on this — because the alternative is what happened
   * live: the job died before its final cleanup, the previous generation was
   * never retired, and the globe drew EVERY shape twice, stacked on itself. It
   * showed up as pairs of "identical overlapping warnings" with matching member
   * counts (66 + 66), which looks like a geometry bug and isn't.
   *
   * Written false, flipped true only when the whole generation has landed. A
   * rebuild that dies half-way therefore leaves shapes nobody can see, rather
   * than a doubled globe — and the next complete rebuild sweeps them.
   */
  live: boolean;
}

export interface iAlertBlobModel extends iAlertBlob {
  id: string;
  _id: string;
}

const BlobCitySchema = new mongoose.Schema<iBlobCity>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    cc: { type: String, required: false },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    population: { type: Number, required: false },
  },
  { _id: false }, // pure embedded copies — an ObjectId each would be dead weight
);

const AlertBlobSchema = new mongoose.Schema<iAlertBlobModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    hazard: { type: String, required: true },
    severityRank: { type: Number, required: true, default: 0 },
    country: { type: String, required: false },
    geometry: { type: mongoose.Schema.Types.Mixed, required: true },
    bbox: { type: [Number], required: true, default: undefined },
    memberIds: { type: [String], default: [] },
    cities: { type: [BlobCitySchema], default: [] },
    builtAt: { type: Date, required: true, default: () => new Date() },
    live: { type: Boolean, required: true, default: false },
  },
  { timestamps: false },
);

// Read path: "every LIVE blob, worst first" — the overlay's only query. `live`
// leads because every read filters on it (see the field).
AlertBlobSchema.index({ live: 1, severityRank: -1 }, { name: "alert_blob_sev_ix" });
// Commit/sweep a generation at the end of a rebuild.
AlertBlobSchema.index({ builtAt: 1 }, { name: "alert_blob_built_ix" });
// Members → blob, for the panel's "which shape is this alert in".
AlertBlobSchema.index({ memberIds: 1 }, { name: "alert_blob_members_ix" });
// The reverse of `cities`: "is this city under a warning right now", answered
// without touching a polygon at all.
AlertBlobSchema.index({ "cities.id": 1 }, { name: "alert_blob_city_ix" });

export const getAlertBlobModel = (conn: Connection) =>
  getModel<iAlertBlobModel>(conn, "AlertBlob", AlertBlobSchema);

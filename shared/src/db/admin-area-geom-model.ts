import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { AlertGeometry } from "./alert-model";

/**
 * `(scheme, code) → administrative-area boundary`, a STATIC reference table.
 *
 * The sibling of `alert_area_geom` (EMMA) for the alert sources that identify an
 * area by a standard administrative code and ship no polygon — France and Hungary
 * tag warnings with a bare NUTS code ("FR715" Loire, "HU33" Dél-Alföld) and
 * nothing else. Unlike EMMA, these codes come from a published nomenclature, so
 * this is a ONE-SHOT bulk import (Eurostat GISCO), not a per-code fetch: `yarn
 * refresh:nuts` loads every polygon once and every future alert joins for free.
 *
 * Kept separate from `alert_area_geom` on purpose: EMMA is a dynamic fetch cache
 * filled a few codes at a time over days; this is a static reference table
 * rewritten wholesale on import. Same job (feed the ingest geometry enrich), very
 * different write lifecycle — see [[alert-geometry-emma-cache]].
 *
 * VINTAGE MATTERS. MeteoAlarm members emit NUTS **2013** codes (FR715 is Loire in
 * 2013; the 2021 nomenclature renamed it FRK25 and 2013 codes 155/155 cover our
 * live feed vs 66/155 for later years). The import pins the year; do not bump it
 * without re-checking what the feed actually sends.
 *
 * No 2dsphere index: this is a keyed lookup, never queried spatially. Geometry is
 * repaired on import (same reason as EMMA — a shape Mongo's 2dsphere would reject
 * becomes a permanent hole once it lands on an alert doc).
 *
 * TWO JOIN SHAPES live here. NUTS joins on the **code** (the alert ships "FR715").
 * China's CMA ships neither code nor polygon — only an English county NAME
 * ("Jinghe County") — so its rows also carry a normalised `nameKey` (matched
 * instead of `code`) and a `centroid` (to disambiguate a name shared by several
 * counties against the alert's other, polygon-bearing areas). A code-join is exact;
 * a name-join is fuzzy and only ever drawn when it is UNAMBIGUOUS or a sibling
 * polygon pins the region — see the resolver in `worker/src/alerts/enrich-geometry`.
 */
export interface iAdminAreaGeom extends iGeneralModel {
  /** The geocode scheme, matching the CAP area `valueName` ("NUTS2", "NUTS3", "GADM3"). */
  scheme: string;
  /** The code within that scheme ("FR715", or a GADM GID_3) — unique within a scheme. */
  code: string;
  /** ISO country code ("FR"), for admin/debug. */
  countryCode?: string;
  /** Area name from the nomenclature — admin/debug for code schemes, joined on for name schemes. */
  name?: string;
  /**
   * Normalised name, the join key for NAME-matched schemes (GADM/China). Absent on
   * code-matched schemes (NUTS). A name may be shared by several rows — see `centroid`.
   */
  nameKey?: string;
  /** [lng, lat] representative point, for disambiguating a shared `nameKey`. */
  centroid?: [number, number];
  geometry: AlertGeometry;
  /** Where it came from + the pinned vintage ("gisco:nuts-2013", "gadm-4.1"). */
  source: string;
  fetchedAt: Date;
}

export interface iAdminAreaGeomModel extends iAdminAreaGeom {
  id: string;
  _id: string;
}

const AdminAreaGeomSchema = new mongoose.Schema<iAdminAreaGeomModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    scheme: { type: String, required: true },
    code: { type: String, required: true },
    countryCode: { type: String, required: false },
    name: { type: String, required: false },
    nameKey: { type: String, required: false },
    centroid: { type: [Number], required: false },
    geometry: { type: mongoose.Schema.Types.Mixed, required: true },
    source: { type: String, required: true, default: "gisco" },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// The primary key. Compound-unique so a code is unambiguous within its scheme and
// an import upserts in place rather than duplicating.
AdminAreaGeomSchema.index({ scheme: 1, code: 1 }, { unique: true, name: "admin_area_geom_key_ix" });

// The name-join index for NAME-matched schemes (GADM/China). Sparse: NUTS rows have
// no nameKey and must not bloat it. NOT unique — a county name can repeat, which is
// exactly why the resolver disambiguates by centroid.
AdminAreaGeomSchema.index(
  { scheme: 1, nameKey: 1 },
  { name: "admin_area_geom_name_ix", sparse: true },
);

export const getAdminAreaGeomModel = (conn: Connection) =>
  getModel<iAdminAreaGeomModel>(conn, "AdminAreaGeom", AdminAreaGeomSchema);

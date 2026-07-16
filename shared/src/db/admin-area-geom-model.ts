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
 */
export interface iAdminAreaGeom extends iGeneralModel {
  /** The geocode scheme, matching the CAP area `valueName` ("NUTS2", "NUTS3"). */
  scheme: string;
  /** The code within that scheme ("FR715") — the other half of the join key. */
  code: string;
  /** ISO country code ("FR"), for admin/debug. */
  countryCode?: string;
  /** Area name from the nomenclature — admin/debug, never joined on. */
  name?: string;
  geometry: AlertGeometry;
  /** Where it came from + the pinned vintage ("gisco:nuts-2013"). */
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
    geometry: { type: mongoose.Schema.Types.Mixed, required: true },
    source: { type: String, required: true, default: "gisco" },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// The join key. Compound-unique so a code is unambiguous within its scheme and an
// import upserts in place rather than duplicating.
AdminAreaGeomSchema.index({ scheme: 1, code: 1 }, { unique: true, name: "admin_area_geom_key_ix" });

export const getAdminAreaGeomModel = (conn: Connection) =>
  getModel<iAdminAreaGeomModel>(conn, "AdminAreaGeom", AdminAreaGeomSchema);

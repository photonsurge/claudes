import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { AlertGeometry } from "./alert-model";

/**
 * EMMA_ID → warning-area boundary cache.
 *
 * MeteoAlarm's CAP feed identifies an alert's area only by name + an `EMMA_ID`
 * geocode ("PL1423") and ships NO geometry, so those alerts can't be drawn. The
 * shape lives in the MeteoGate EDR API instead, one fetch per alert. An EMMA area
 * is an administrative region, so its polygon is stable and reusable forever:
 * we resolve each EMMA_ID once here and every future alert for that area joins
 * against this cache at ingest for free (see the alerts ingest geometry enrich).
 *
 * `precision` records what we actually got. The EDR feature carries a cheap
 * inline bbox and links to the true shape; `exact` is the real boundary, `bbox`
 * the rectangle fallback when the shape fetch failed. A later run upgrades a
 * `bbox` row to `exact` — never the reverse.
 *
 * No 2dsphere index here: nothing queries this collection spatially (it's a
 * keyed lookup), and indexing it would re-litigate polygon validity on write.
 */
export interface iAlertAreaGeom extends iGeneralModel {
  /** MeteoAlarm/EMMA area code ("PL1423") — the upsert + join key. */
  emmaId: string;
  /** ISO country code the area belongs to ("PL"), from the EDR feature. */
  countryCode?: string;
  /** Area name as the source described it — for admin/debug, never joined on. */
  areaDesc?: string;
  geometry: AlertGeometry;
  /** Whether `geometry` is the true boundary or the bbox fallback. */
  precision: "exact" | "bbox";
  /** Feed that resolved it ("meteogate"). */
  source: string;
  fetchedAt: Date;
  /**
   * When the worker last checked this boundary is one Mongo will actually store.
   *
   * A handful of real coastlines pinch themselves (a ring revisiting a vertex),
   * which the 2dsphere refuses — and because a boundary is resolved ONCE and kept
   * forever, a bad one is a permanent hole: the area never gets a footprint and
   * there's nothing left to re-fetch. New rows are repaired on the way in, so
   * this only marks the backlog as it gets swept — absent means "not looked at
   * yet", not "broken".
   */
  checkedAt?: Date;
}

export interface iAlertAreaGeomModel extends iAlertAreaGeom {
  id: string;
  _id: string;
}

const AlertAreaGeomSchema = new mongoose.Schema<iAlertAreaGeomModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    emmaId: { type: String, required: true, unique: true },
    countryCode: { type: String, required: false },
    areaDesc: { type: String, required: false },
    geometry: { type: mongoose.Schema.Types.Mixed, required: true },
    precision: { type: String, required: true, enum: ["exact", "bbox"], default: "exact" },
    source: { type: String, required: true, default: "meteogate" },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    checkedAt: { type: Date, required: false },
  },
  { timestamps: false },
);

AlertAreaGeomSchema.index({ emmaId: 1 }, { unique: true, name: "alert_area_geom_emma_ix" });
// "What's left to sweep" — sparse, so it shrinks to nothing as the backlog clears.
AlertAreaGeomSchema.index({ checkedAt: 1 }, { name: "alert_area_geom_checked_ix", sparse: true });

export const getAlertAreaGeomModel = (conn: Connection) =>
  getModel<iAlertAreaGeomModel>(conn, "AlertAreaGeom", AlertAreaGeomSchema);

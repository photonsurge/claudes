import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Ledger of MeteoGate alerts we've already resolved to an EMMA area.
 *
 * The EDR locations feed lists a feature per (alert × area × language) but does
 * NOT include the EMMA_ID inline — learning it costs one fetch of the alert's
 * linked CAP JSON. Without this ledger every sync would re-fetch every active
 * alert across ~37 countries (thousands of requests) only to rediscover EMMA
 * areas already cached. Recording the alertIds we've resolved reduces steady
 * state to just the alerts that appeared since the last run.
 *
 * Rows are pure cache: TTL'd out once the alert is long dead, since a lapsed
 * alertId will never be seen in the feed again. The boundary it taught us lives
 * on in the (permanent) EMMA cache — see {@link iAlertAreaGeom}.
 */
export interface iAlertGeomSeen extends iGeneralModel {
  /** MeteoGate alert UUID from the EDR feature. */
  alertId: string;
  /** EMMA_ID it resolved to, or absent when the alert carried no EMMA geocode. */
  emmaId?: string;
  seenAt: Date;
}

export interface iAlertGeomSeenModel extends iAlertGeomSeen {
  id: string;
  _id: string;
}

/** How long a resolved alertId stays remembered. Well past any alert's life. */
const SEEN_TTL_SEC = Number(process.env.ALERT_GEOM_SEEN_TTL_SEC || 30 * 24 * 60 * 60);

const AlertGeomSeenSchema = new mongoose.Schema<iAlertGeomSeenModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    alertId: { type: String, required: true, unique: true },
    emmaId: { type: String, required: false },
    seenAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

AlertGeomSeenSchema.index({ alertId: 1 }, { unique: true, name: "alert_geom_seen_id_ix" });
AlertGeomSeenSchema.index(
  { seenAt: 1 },
  { expireAfterSeconds: SEEN_TTL_SEC, name: "alert_geom_seen_ttl_ix" },
);

export const getAlertGeomSeenModel = (conn: Connection) =>
  getModel<iAlertGeomSeenModel>(conn, "AlertGeomSeen", AlertGeomSeenSchema);

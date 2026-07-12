import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * An official resource discovered on an alert's feed payload — a report link, a
 * hazard icon, a GDACS map, a CAP `<resource>` image. We store the REFERENCE
 * (url + attribution), not the bytes: harvesting is cheap and cannot assume
 * reuse rights. Deduped on `(source, identifier, url)`. Mirrors the fire-repo
 * `upsertMany` bulk pattern.
 */

export type AlertResourceKind = "map" | "icon" | "report" | "image" | "resource";

export interface iAlertResource extends iGeneralModel {
  source: string;
  identifier: string;
  /** The Alert doc uuid, when known (may be absent on the first harvest). */
  alertId?: string;
  url: string;
  mimeType?: string;
  kind: AlertResourceKind;
  description?: string;
  harvestedAt: Date;
}

export interface iAlertResourceModel extends iAlertResource {
  id: string;
  _id: string;
}

export const AlertResourceSchema = new mongoose.Schema<iAlertResourceModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    source: { type: String, required: true },
    identifier: { type: String, required: true },
    alertId: { type: String, required: false },
    url: { type: String, required: true },
    mimeType: { type: String, required: false },
    kind: { type: String, required: true, default: "resource" },
    description: { type: String, required: false },
    harvestedAt: { type: Date, required: true, default: () => new Date() },
  },
  mongoTimestamps,
);

AlertResourceSchema.index({ source: 1, identifier: 1, url: 1 }, { unique: true, name: "alert_res_dedup_ix" });
AlertResourceSchema.index({ source: 1, identifier: 1, harvestedAt: 1 }, { name: "alert_res_alert_ix" });

export const getAlertResourceModel = (conn: Connection) =>
  getModel<iAlertResourceModel>(conn, "AlertResource", AlertResourceSchema);

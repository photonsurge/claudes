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
export interface iAlertBlob extends iGeneralModel {
  /** Hazard bucket the members share ("Thunderstorm"). */
  hazard: string;
  severityRank: SeverityRank;
  geometry: AlertGeometry;
  /** Alert ids that went into this shape — panels still list them individually. */
  memberIds: string[];
  builtAt: Date;
}

export interface iAlertBlobModel extends iAlertBlob {
  id: string;
  _id: string;
}

const AlertBlobSchema = new mongoose.Schema<iAlertBlobModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    hazard: { type: String, required: true },
    severityRank: { type: Number, required: true, default: 0 },
    geometry: { type: mongoose.Schema.Types.Mixed, required: true },
    memberIds: { type: [String], default: [] },
    builtAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// Read path: "every blob, worst first" — the overlay's only query.
AlertBlobSchema.index({ severityRank: -1 }, { name: "alert_blob_sev_ix" });
// Members → blob, for the panel's "which shape is this alert in".
AlertBlobSchema.index({ memberIds: 1 }, { name: "alert_blob_members_ix" });

export const getAlertBlobModel = (conn: Connection) =>
  getModel<iAlertBlobModel>(conn, "AlertBlob", AlertBlobSchema);

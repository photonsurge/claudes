import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * WMO `capurl` → canonical national CAP identifier.
 *
 * WMO's WFS view ships an EMPTY identifier column on every feature, so its alerts
 * are keyed by `capurl` and can't be matched to the same warning arriving via
 * MeteoAlarm or NWS. The identifier isn't missing though — it's in the original
 * CAP XML that `capurl` points at. Resolving it is what makes cross-source dedup
 * exact instead of fuzzy (see docs/alert-dedup-merge-plan.md).
 *
 * Cacheable forever: a capurl is content-addressed (the filename is a hash of the
 * document), so a given capurl always yields the same CAP message. We never need
 * to re-fetch one, which is what keeps this affordable across ~3.6k live alerts.
 *
 * `capId` is null for a capurl whose XML carried no identifier — cached anyway so
 * we don't pay for it again.
 */
export interface iCapId extends iGeneralModel {
  /** WMO capurl ("pl-imgw-xx/2026/07/15/12/02/00-13bbaeab….xml") — the upsert key. */
  capurl: string;
  /** The CAP identifier from the XML, or null if it had none. */
  capId: string | null;
  /** CAP `<sender>` — useful for auditing which authority actually issued it. */
  sender?: string;
  fetchedAt: Date;
}

export interface iCapIdModel extends iCapId {
  id: string;
  _id: string;
}

const CapIdSchema = new mongoose.Schema<iCapIdModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    capurl: { type: String, required: true, unique: true, maxlength: 512 },
    capId: { type: String, required: false, default: null, maxlength: 512 },
    sender: { type: String, required: false, maxlength: 512 },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

CapIdSchema.index({ capurl: 1 }, { unique: true, name: "cap_id_capurl_ix" });

export const getCapIdModel = (conn: Connection) => getModel<iCapIdModel>(conn, "CapId", CapIdSchema);

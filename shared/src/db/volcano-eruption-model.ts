import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * GVP eruption history — one PERMANENT row per Smithsonian VOTW eruption (~11,089
 * across every Holocene volcano), upserted on the stable `eruptionNumber`. This is
 * a CATALOG FACT, not an observation: it belongs to the volcano regardless of any
 * WatchedEvent, so it lives here rather than in `event_series` (which models
 * per-event numeric observations). Powers "last erupted 1707" / "12 eruptions since
 * 1900" and Band 2 of the per-volcano timeline (P7 §7.4/§7.12).
 *
 * DATES ARE FUZZY AND FLATTENED — deliberately not `Date` (verified live):
 *   - `startYear` reaches -55500 (BCE); `new Date(y, …)` maps years 0-99 to 1900+,
 *     so building a Date from these silently corrupts them.
 *   - GVP uses **0 as an "unknown" sentinel** for month/day in ~1/3 of rows.
 *   - ~56% of rows have no end date at all.
 * So year/month/day are stored as numbers with an explicit `precision`, and a
 * caller renders the fuzziness (`formatGvpDate`) rather than inventing accuracy.
 * Flattened (not a subdoc) so `{volcanoId, startYear:-1}` sorts the history.
 */

export type EruptionDatePrecision = "year" | "month" | "day";

export interface iVolcanoEruption extends iGeneralModel {
  /** `gvp:<vnum>` — the volcano this eruption belongs to. */
  volcanoId: string;
  /** GVP's stable eruption id — the upsert key. */
  eruptionNumber: number;
  volcanoName?: string;
  /** "Confirmed Eruption" | "Uncertain Eruption". */
  activityType?: string;
  confirmed: boolean;
  /** Volcanic Explosivity Index 0-7; absent when GVP assigned none. */
  vei?: number;
  veiModifier?: string;
  /** May be NEGATIVE (BCE). */
  startYear: number;
  startMonth?: number;
  startDay?: number;
  startPrecision: EruptionDatePrecision;
  /** GVP's "?" / "<" / ">" qualifier. */
  startModifier?: string;
  startUncertaintyYears?: number;
  startEvidence?: string;
  endYear?: number;
  endMonth?: number;
  endDay?: number;
  endPrecision?: EruptionDatePrecision;
  endModifier?: string;
  endUncertaintyYears?: number;
  fetchedAt: Date;
}

export interface iVolcanoEruptionModel extends iVolcanoEruption {
  id: string;
  _id: string;
}

export const VolcanoEruptionSchema = new mongoose.Schema<iVolcanoEruptionModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    volcanoId: { type: String, required: true },
    eruptionNumber: { type: Number, required: true, unique: true },
    volcanoName: { type: String, required: false },
    activityType: { type: String, required: false },
    confirmed: { type: Boolean, required: true, default: false },
    vei: { type: Number, required: false },
    veiModifier: { type: String, required: false },
    startYear: { type: Number, required: true },
    startMonth: { type: Number, required: false },
    startDay: { type: Number, required: false },
    startPrecision: { type: String, required: true, default: "year" },
    startModifier: { type: String, required: false },
    startUncertaintyYears: { type: Number, required: false },
    startEvidence: { type: String, required: false },
    endYear: { type: Number, required: false },
    endMonth: { type: Number, required: false },
    endDay: { type: Number, required: false },
    endPrecision: { type: String, required: false },
    endModifier: { type: String, required: false },
    endUncertaintyYears: { type: Number, required: false },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

// No TTL: eruption history is permanent (the 1707 eruption is not going stale).
VolcanoEruptionSchema.index({ eruptionNumber: 1 }, { unique: true, name: "volcano_eruption_num_ix" });
VolcanoEruptionSchema.index({ volcanoId: 1, startYear: -1 }, { name: "volcano_eruption_volcano_ix" });

export const getVolcanoEruptionModel = (conn: Connection) =>
  getModel<iVolcanoEruptionModel>(conn, "VolcanoEruption", VolcanoEruptionSchema);

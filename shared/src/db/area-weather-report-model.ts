import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { HazardType } from "../alerts/hazard";
import type { SeverityRank } from "./alert-model";

/**
 * One hourly area-weather snapshot for a Country or Region: real-boundary
 * (country) or bbox (region) mean/min/max per variable, plus hazard flags
 * from the existing forecast-hazard rule table applied to this hour's
 * min/max instead of a multi-day forecast. Appended, never overwritten —
 * same history-keeps-forever convention as EventSummary.
 */
export type AreaPlaceKind = "country" | "region";

export interface iAreaVariableStats {
  variable: string;
  units: string;
  mean: number;
  min: number;
  max: number;
  /** Pixels sampled after masking/striding — 0 means the frame missed this place entirely. */
  count: number;
}

export interface iAreaHazardFlag {
  hazard: HazardType;
  severityRank: SeverityRank;
  label: string;
}

export interface iAreaWeatherReport extends iGeneralModel {
  placeKind: AreaPlaceKind;
  /** Country.countryId or Region.regionId. */
  placeId: string;
  name: string;
  generatedAt: Date;
  stats: iAreaVariableStats[];
  hazards: iAreaHazardFlag[];
}

export interface iAreaWeatherReportModel extends iAreaWeatherReport {
  id: string;
  _id: string;
}

const AreaVariableStatsSchema = new mongoose.Schema<iAreaVariableStats>(
  {
    variable: { type: String, required: true },
    units: { type: String, required: true, default: "" },
    mean: { type: Number, required: true },
    min: { type: Number, required: true },
    max: { type: Number, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const AreaHazardFlagSchema = new mongoose.Schema<iAreaHazardFlag>(
  {
    hazard: { type: String, required: true },
    severityRank: { type: Number, required: true, min: 0, max: 4 },
    label: { type: String, required: true },
  },
  { _id: false },
);

const AreaWeatherReportSchema = new mongoose.Schema<iAreaWeatherReportModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    placeKind: { type: String, required: true, enum: ["country", "region"] },
    placeId: { type: String, required: true },
    name: { type: String, required: true },
    generatedAt: { type: Date, required: true, default: () => new Date() },
    stats: { type: [AreaVariableStatsSchema], default: [] },
    hazards: { type: [AreaHazardFlagSchema], default: [] },
  },
  mongoTimestamps,
);

// Latest-by-place read + history newest-first.
AreaWeatherReportSchema.index(
  { placeKind: 1, placeId: 1, generatedAt: -1 },
  { name: "area_weather_place_gen_ix" },
);

export const getAreaWeatherReportModel = (conn: Connection) =>
  getModel<iAreaWeatherReportModel>(conn, "AreaWeatherReport", AreaWeatherReportSchema);

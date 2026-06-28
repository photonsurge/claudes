import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

export type WeatherEncoding = "uv" | "scalar";
export type RunStatus = "pending" | "complete" | "failed";

/** One forecast step within a run. */
export interface iWeatherStep {
  /** ISO valid time of this step. */
  validTime: string;
  /** Forecast hour offset from the run time (0 = analysis/nowcast). */
  fhr: number;
}

/**
 * Per-variable metadata for a run. `files` maps a forecast hour (as a string
 * key) to the `id` of the WeatherTexture holding that step's baked image.
 * The Next manifest route rewrites those ids into `/api/weather/tex/<id>` URLs.
 */
export interface iWeatherVariableEntry {
  encoding: WeatherEncoding;
  units: string;
  domain?: [number, number];
  palette?: string;
  /** Wind only: the byte-scale range used to encode u/v into the RG PNG. */
  imageUnscale?: [number, number];
  files: Record<string, string>;
}

export interface iWeatherRun extends iGeneralModel {
  /** Model id, e.g. "gfs". */
  model: string;
  /** Nominal run/cycle time (e.g. the 12Z analysis). */
  run: Date;
  /** When the worker finished baking this run. */
  generatedAt?: Date;
  status: RunStatus;
  /** Only published runs are served to the browser. */
  published: boolean;
  /** Geographic extent [west, south, east, north] in −180..180 / −90..90. */
  bounds: number[];
  grid: { width: number; height: number; res: number };
  steps: iWeatherStep[];
  variables: Record<string, iWeatherVariableEntry>;
}

export interface iWeatherRunModel extends iWeatherRun {
  id: string;
  _id: string;
}

const WeatherStepSchema = new mongoose.Schema<iWeatherStep>(
  {
    validTime: { type: String, required: true },
    fhr: { type: Number, required: true },
  },
  { _id: false },
);

const WeatherRunSchema = new mongoose.Schema<iWeatherRunModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    model: { type: String, required: true, default: "gfs" },
    run: { type: Date, required: true },
    generatedAt: { type: Date, required: false },
    status: {
      type: String,
      required: true,
      enum: ["pending", "complete", "failed"],
      default: "pending",
    },
    published: { type: Boolean, required: true, default: false },
    bounds: { type: [Number], required: true, default: [-180, -90, 180, 90] },
    grid: {
      width: { type: Number, required: true },
      height: { type: Number, required: true },
      res: { type: Number, required: true },
    },
    steps: { type: [WeatherStepSchema], required: true, default: [] },
    variables: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
  },
  mongoTimestamps,
);

WeatherRunSchema.index({ model: 1, run: -1 }, { name: "run_model_time_ix" });
WeatherRunSchema.index({ published: 1, run: -1 }, { name: "run_published_ix" });

export const getWeatherRunModel = (conn: Connection) =>
  getModel<iWeatherRunModel>(conn, "WeatherRun", WeatherRunSchema);

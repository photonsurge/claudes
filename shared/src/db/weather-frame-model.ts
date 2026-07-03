import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { WeatherEncoding } from "./weather-run-model";
import type { TextureContentType } from "./weather-texture-model";

/**
 * The long-term weather ARCHIVE: one doc per (model, variable, validTime)
 * holding the near-analysis baked texture for that moment, plus everything
 * needed to decode it back to physical values (imageUnscale / vectorUnscale,
 * bounds, grid). Run retention prunes WeatherRun/WeatherTexture after a few
 * cycles; frames are deliberately NOT pruned, so historical point sampling
 * ("temperature in Tokyo last Tuesday") and, later, map replay keep working.
 *
 * Frames are upserted at publish time from the lowest available forecast hours
 * (default f000/f003), so each frame is the freshest short-lead estimate of
 * that valid time — effectively an analysis record, not a stale forecast.
 */
export interface iWeatherFrame extends iGeneralModel {
  /** Source model id, e.g. "gfs", "rtofs", "gfswave-mosaic". */
  model: string;
  /** Variable id (e.g. "temp", "wind"). */
  variable: string;
  /** The moment this frame describes. */
  validTime: Date;
  /** Run cycle the frame was baked from. */
  run: Date;
  /** Forecast hour within that run (lower = fresher analysis; wins on upsert). */
  fhr: number;
  encoding: WeatherEncoding;
  units: string;
  /** Scalar: byte → physical decode range. */
  imageUnscale?: [number, number];
  /** Vector ("uv"): symmetric per-channel decode range. */
  vectorUnscale?: [number, number];
  /** [west, south, east, north] the texture covers. */
  bounds: number[];
  grid: { width: number; height: number; res: number };
  contentType: TextureContentType;
  data: Buffer;
  byteSize: number;
}

export interface iWeatherFrameModel extends iWeatherFrame {
  id: string;
  _id: string;
}

const WeatherFrameSchema = new mongoose.Schema<iWeatherFrameModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    model: { type: String, required: true },
    variable: { type: String, required: true },
    validTime: { type: Date, required: true },
    run: { type: Date, required: true },
    fhr: { type: Number, required: true },
    encoding: { type: String, required: true, enum: ["uv", "scalar"] },
    units: { type: String, required: true, default: "" },
    imageUnscale: { type: [Number], required: false },
    vectorUnscale: { type: [Number], required: false },
    bounds: { type: [Number], required: true, default: [-180, -90, 180, 90] },
    grid: {
      width: { type: Number, required: true },
      height: { type: Number, required: true },
      res: { type: Number, required: true },
    },
    contentType: { type: String, required: true, enum: ["image/png", "image/tiff"] },
    data: { type: Buffer, required: true },
    byteSize: { type: Number, required: true, default: 0 },
  },
  mongoTimestamps,
);

WeatherFrameSchema.index(
  { model: 1, variable: 1, validTime: 1 },
  { unique: true, name: "frame_model_var_time_ix" },
);
// Series scans ("all temp frames between from..to", any model).
WeatherFrameSchema.index({ variable: 1, validTime: 1 }, { name: "frame_var_time_ix" });

export const getWeatherFrameModel = (conn: Connection) =>
  getModel<iWeatherFrameModel>(conn, "WeatherFrame", WeatherFrameSchema);

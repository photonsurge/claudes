import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { WeatherEncoding } from "./weather-run-model";
import type { TextureContentType } from "./weather-texture-model";

/**
 * The rolling FORECAST store: one doc per (model, variable, validTime) for
 * moments still in the future, holding the baked texture predicting that
 * moment. Unlike WeatherFrame (a permanent analysis archive where the lowest
 * forecast hour wins), a newer GFS run's guess for a given future validTime
 * always supersedes an older run's — see `forecastShouldReplace` — and
 * elapsed validTimes are pruned rather than kept forever.
 */
export interface iWeatherForecastFrame extends iGeneralModel {
  /** Source model id, e.g. "gfs". */
  model: string;
  /** Variable id (e.g. "temp", "wind"). */
  variable: string;
  /** The future moment this frame predicts. */
  validTime: Date;
  /** Run cycle the frame was baked from (higher/newer wins on upsert). */
  run: Date;
  /** Forecast hour within that run. */
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
  /**
   * Texture bytes. Stored in the `WeatherForecastFrameData` sidecar collection
   * and joined by id (blob-store.ts); `getSeries`/`getByID` reattach it. The
   * bytes-free view is `WeatherForecastFrameMeta`. Must not be paged through
   * Mongo by the `listMeta` scan.
   */
  data: Buffer;
  byteSize: number;
}

export interface iWeatherForecastFrameModel extends iWeatherForecastFrame {
  id: string;
  _id: string;
}

const WeatherForecastFrameSchema = new mongoose.Schema<iWeatherForecastFrameModel>(
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
    // Bytes live in the WeatherForecastFrameData sidecar (blob-store). Optional
    // here so new rows are metadata-only; pre-migration rows keep it inline as a
    // read fallback until the backfill unsets them.
    data: { type: Buffer, required: false },
    byteSize: { type: Number, required: true, default: 0 },
  },
  mongoTimestamps,
);

WeatherForecastFrameSchema.index(
  { model: 1, variable: 1, validTime: 1 },
  { unique: true, name: "fcast_model_var_time_ix" },
);
// Series scans ("all temp forecast frames", any model).
WeatherForecastFrameSchema.index({ variable: 1, validTime: 1 }, { name: "fcast_var_time_ix" });
// Pruning elapsed validTimes (WeatherFrame never needed this — it never prunes by default).
WeatherForecastFrameSchema.index({ validTime: 1 }, { name: "fcast_time_ix" });

export const getWeatherForecastFrameModel = (conn: Connection) =>
  getModel<iWeatherForecastFrameModel>(conn, "WeatherForecastFrame", WeatherForecastFrameSchema);

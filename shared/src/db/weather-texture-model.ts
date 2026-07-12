import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { WeatherEncoding } from "./weather-run-model";

export type TextureContentType = "image/png" | "image/tiff";

/**
 * A single baked texture (one variable, one forecast step of one run) stored as
 * a binary blob in Mongo. At 0.25° global a wind RG-PNG / scalar Float32 GeoTIFF
 * is well under the 16 MB document limit, so the bytes live directly on the doc.
 * The browser fetches them through `/api/weather/tex/<id>`.
 */
export interface iWeatherTexture extends iGeneralModel {
  /** id of the owning WeatherRun. */
  runId: string;
  /** Variable id (e.g. "wind", "temp"). */
  variable: string;
  /** Forecast hour. */
  fhr: number;
  contentType: TextureContentType;
  encoding: WeatherEncoding;
  data: Buffer;
  byteSize: number;
}

export interface iWeatherTextureModel extends iWeatherTexture {
  id: string;
  _id: string;
}

const WeatherTextureSchema = new mongoose.Schema<iWeatherTextureModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    runId: { type: String, required: true },
    variable: { type: String, required: true },
    fhr: { type: Number, required: true },
    contentType: { type: String, required: true, enum: ["image/png", "image/tiff"] },
    encoding: { type: String, required: true, enum: ["uv", "scalar"] },
    // Optional: bytes live on the shared ${BLOB_DIR} folder when FS-backed, only
    // inline here off-FS or before the migrate:blobs pass. See weather-texture-repo.
    data: { type: Buffer, required: false },
    byteSize: { type: Number, required: true, default: 0 },
  },
  mongoTimestamps,
);

WeatherTextureSchema.index(
  { runId: 1, variable: 1, fhr: 1 },
  { unique: true, name: "texture_run_var_fhr_ix" },
);

export const getWeatherTextureModel = (conn: Connection) =>
  getModel<iWeatherTextureModel>(conn, "WeatherTexture", WeatherTextureSchema);

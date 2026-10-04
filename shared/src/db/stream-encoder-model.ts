import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { StreamEncoder } from "../runs";

/**
 * A registered OBS instance (obs-websocket v5 endpoint) the worker can drive.
 * One instance = one streaming output, so N concurrent runs need N encoders —
 * this registry is the multi-view unlock. `sceneId` records which scene the
 * instance's browser source captures so run-creation can auto-pick it.
 *
 * The websocket password is stored ENCRYPTED (`passwordEnc`, AES-256-GCM via
 * ../utill/secretbox — same scheme as the YouTube refresh token) and only the
 * worker ever decrypts it; the admin API serves a `hasPassword` flag instead.
 */
export interface iStreamEncoderModel extends iGeneralModel, StreamEncoder {
  id: string;
  _id: string;
}

const StreamEncoderSchema = new mongoose.Schema<iStreamEncoderModel>(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: false },
    url: { type: String, required: true },
    passwordEnc: { type: String, required: false },
    sceneId: { type: String, required: false, index: true },
    // "channels" (default) | "videos" — see StreamEncoder.use (short-video plan §6.6).
    use: { type: String, required: false, enum: ["channels", "videos"], default: "channels" },
    enabled: { type: Boolean, required: false, default: true, index: true },
  },
  mongoTimestamps,
);

export const getStreamEncoderModel = (conn: Connection) =>
  getModel<iStreamEncoderModel>(conn, "StreamEncoder", StreamEncoderSchema);

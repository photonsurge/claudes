import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * A connected YouTube channel's OAuth credentials. One doc per channel, keyed by
 * `id = channelId`, so a multi-channel setup is possible once runs exist. The
 * refresh token is stored ENCRYPTED (`refreshTokenEnc`, AES-256-GCM via
 * ../utill/secretbox) — never in plaintext, and never the short-lived access
 * token (that is minted/cached at runtime by the worker's youtube client).
 *
 * Only the WORKER reads/writes this (it holds the secretbox key); `public` never
 * touches the token — it delegates the OAuth code→token exchange to the worker.
 */
export interface iYoutubeAccount {
  id?: string; // = channelId
  channelTitle?: string;
  /** AES-256-GCM blob of the OAuth refresh token. */
  refreshTokenEnc?: string;
  scopes?: string[];
  connectedAt?: number;
  connectedBy?: string;
}

export interface iYoutubeAccountModel extends iGeneralModel, iYoutubeAccount {
  id: string;
  _id: string;
}

const YoutubeAccountSchema = new mongoose.Schema<iYoutubeAccountModel>(
  {
    id: { type: String, required: true, unique: true },
    channelTitle: { type: String, required: false },
    refreshTokenEnc: { type: String, required: false },
    scopes: { type: [String], required: false, default: [] },
    connectedAt: { type: Number, required: false },
    connectedBy: { type: String, required: false },
  },
  mongoTimestamps,
);

export const getYoutubeAccountModel = (conn: Connection) =>
  getModel<iYoutubeAccountModel>(conn, "YoutubeAccount", YoutubeAccountSchema);

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
/**
 * Why Google last refused this channel's credentials — stamped by the worker when
 * the token endpoint answers `invalid_grant` (refresh token expired: consent screen
 * still in "Testing", or revoked by the user), cleared by the next successful call
 * or a reconnect. Drives the "needs reconnect" chip on /admin/youtube.
 */
export interface iYoutubeAuthError {
  kind: string;
  message: string;
  at: number;
}

export interface iYoutubeAccount {
  id?: string; // = channelId
  channelTitle?: string;
  /** AES-256-GCM blob of the OAuth refresh token. */
  refreshTokenEnc?: string;
  scopes?: string[];
  connectedAt?: number;
  connectedBy?: string;
  authError?: iYoutubeAuthError | null;
  /** Last authenticated API success (worker-stamped, throttled to ~10 min). */
  lastOkAt?: number;
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
    authError: { type: mongoose.Schema.Types.Mixed, required: false, default: null },
    lastOkAt: { type: Number, required: false },
  },
  mongoTimestamps,
);

export const getYoutubeAccountModel = (conn: Connection) =>
  getModel<iYoutubeAccountModel>(conn, "YoutubeAccount", YoutubeAccountSchema);

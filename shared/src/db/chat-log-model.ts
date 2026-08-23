import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Persisted live-chat log — one doc per platform chat message, written by the
 * worker's chat poller (worker/src/stream/chat.ts) and read back for the
 * operator panel's cold-start history and the /admin/streams per-run chat view.
 * The doc shape mirrors the wire `ChatMessage` (shared/src/runs.ts) exactly, so
 * a stored message round-trips to the socket type with no mapping.
 *
 * `id` is the PLATFORM message id (YouTube liveChatMessage id) — the natural
 * dedupe key, so re-polls and worker restarts can blind-append and let the
 * unique index drop duplicates.
 *
 * Kept forever by default; set CHAT_LOG_TTL_SEC to auto-expire old messages.
 */
const TTL_SEC = Number(process.env.CHAT_LOG_TTL_SEC || 0);

export interface iChatLogMessage extends iGeneralModel {
  /** Platform message id (unique — the dedupe key). */
  id: string;
  runId: string;
  sceneId: string;
  platform: string;
  author: string;
  text: string;
  /** Platform publish time, epoch ms. */
  ts: number;
  isMod?: boolean;
  isOwner?: boolean;
  authorPhoto?: string;
  /** Formatted super-chat amount (e.g. "$5.00"), if this is a paid message. */
  superchatAmount?: string;
}

const ChatLogMessageSchema = new mongoose.Schema<iChatLogMessage>(
  {
    id: { type: String, required: true, unique: true },
    runId: { type: String, required: true },
    sceneId: { type: String, required: true },
    platform: { type: String, required: true, default: "youtube" },
    author: { type: String, required: true, default: "" },
    text: { type: String, required: true, default: "" },
    ts: { type: Number, required: true },
    isMod: { type: Boolean, required: false },
    isOwner: { type: Boolean, required: false },
    authorPhoto: { type: String, required: false },
    superchatAmount: { type: String, required: false },
  },
  mongoTimestamps,
);

// Playback order for one run's log.
ChatLogMessageSchema.index({ runId: 1, ts: 1 }, { name: "chat_run_ts_ix" });
if (TTL_SEC > 0) {
  ChatLogMessageSchema.index({ created: 1 }, { name: "chat_ttl_ix", expireAfterSeconds: TTL_SEC });
}

export const getChatLogMessageModel = (conn: Connection) =>
  getModel<iChatLogMessage>(conn, "ChatLogMessage", ChatLogMessageSchema);

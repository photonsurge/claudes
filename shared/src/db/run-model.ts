import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { Run, RunStatus, RunPhase, YoutubePrivacy } from "../runs";

/**
 * A streaming run: a bounded-lifetime live broadcast bound to an existing scene
 * (collection `runs` — no clash with the director's as-run log `airruns`). Scenes
 * stay permanent config; runs are the ephemeral platform-binding layer on top.
 * One active run per scene at a time (enforced in the data-access layer).
 *
 * The RTMP `platforms.youtube.streamName` field is the SECRET stream key — it is
 * never emitted over the socket (see `toRunState` in ../runs), only served from
 * the admin `/api/streams` surface.
 */
const RUN_STATUSES: RunStatus[] = [
  "scheduled",
  "awaiting-ingest",
  "live",
  "ending",
  "ended",
  "stopped",
  "failed",
];
const RUN_PHASES: RunPhase[] = [
  "created",
  "broadcast",
  "stream",
  "bound",
  "obs-config",
  "obs-start",
  "confirmed",
  "live",
];
const PRIVACIES: YoutubePrivacy[] = ["public", "unlisted", "private"];

export interface iRunModel extends iGeneralModel, Run {
  id: string;
  _id: string;
}

const RunSchema = new mongoose.Schema<iRunModel>(
  {
    id: { type: String, required: true, unique: true },
    sceneId: { type: String, required: true, index: true },
    encoderId: { type: String, required: false },
    slotId: { type: String, required: false },
    status: { type: String, required: true, enum: RUN_STATUSES, default: "scheduled", index: true },
    phase: { type: String, required: false, enum: RUN_PHASES, default: "created" },
    title: { type: String, required: false },
    privacy: { type: String, required: false, enum: PRIVACIES, default: "unlisted" },
    startAt: { type: Number, required: false, default: null },
    durationMs: { type: Number, required: false, default: null },
    endedAt: { type: Number, required: false, default: null },
    platforms: {
      youtube: {
        accountId: { type: String, required: false },
        channelId: { type: String, required: false },
        broadcastId: { type: String, required: false },
        streamId: { type: String, required: false },
        liveChatId: { type: String, required: false },
        ingestionAddress: { type: String, required: false },
        streamName: { type: String, required: false },
        monitorStream: { type: Boolean, required: false, default: false },
        watchUrl: { type: String, required: false },
      },
      twitch: {
        channelLogin: { type: String, required: false },
        chatOnly: { type: Boolean, required: false },
      },
      kick: {
        channelSlug: { type: String, required: false },
        chatOnly: { type: Boolean, required: false },
      },
    },
    obs: {
      configured: { type: Boolean, required: false, default: false },
      streaming: { type: Boolean, required: false, default: false },
      lastBytes: { type: Number, required: false },
      lastBytesAt: { type: Number, required: false },
    },
    chat: {
      enabled: { type: Boolean, required: false, default: false },
      promoteToTicker: { type: Boolean, required: false, default: false },
    },
    announce: { type: Boolean, required: false, default: false },
    announcedAt: { type: Number, required: false, default: null },
    error: {
      step: { type: String, required: false },
      message: { type: String, required: false },
      at: { type: Number, required: false },
    },
    createdBy: { type: String, required: false },
  },
  mongoTimestamps,
);

export const getRunModel = (conn: Connection) => getModel<iRunModel>(conn, "Run", RunSchema);

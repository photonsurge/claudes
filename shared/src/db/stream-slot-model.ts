import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { StreamSlot, YoutubePrivacy } from "../runs";

/**
 * Desired-state config for a persistent ("constant") stream. While `enabled`,
 * the worker's slot reconciler keeps an unbounded run live on this scene +
 * encoder, restarting dead runs with exponential backoff (`failCount` /
 * `lastAttemptAt`). Scenes stay permanent config, runs stay ephemeral — a slot
 * is the standing order that there should always BE a run.
 */
const PRIVACIES: YoutubePrivacy[] = ["public", "unlisted", "private"];

export interface iStreamSlotModel extends iGeneralModel, StreamSlot {
  id: string;
  _id: string;
}

const StreamSlotSchema = new mongoose.Schema<iStreamSlotModel>(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: false },
    sceneId: { type: String, required: true, index: true },
    encoderId: { type: String, required: false },
    accountId: { type: String, required: false },
    title: { type: String, required: false },
    privacy: { type: String, required: false, enum: PRIVACIES, default: "public" },
    enabled: { type: Boolean, required: false, default: false, index: true },
    monitorStream: { type: Boolean, required: false, default: false },
    chat: {
      enabled: { type: Boolean, required: false, default: true },
      promoteToTicker: { type: Boolean, required: false, default: false },
    },
    restartEveryMs: { type: Number, required: false, default: null },
    announce: { type: Boolean, required: false, default: false },
    runId: { type: String, required: false, default: null },
    failCount: { type: Number, required: false, default: 0 },
    lastAttemptAt: { type: Number, required: false, default: null },
  },
  mongoTimestamps,
);

export const getStreamSlotModel = (conn: Connection) =>
  getModel<iStreamSlotModel>(conn, "StreamSlot", StreamSlotSchema);

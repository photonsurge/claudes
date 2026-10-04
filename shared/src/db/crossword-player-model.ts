import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { CrosswordPlayer } from "../crossword-records";

/**
 * One row per player who ever answered (docs/crossword-mode-plan.md §9). The id
 * is `youtube:<authorChannelId>` (or `sim:<name>` from the Desk's simulator).
 * `hidden` players are ignored by the runner and left off the boards.
 */
export interface iCrosswordPlayerModel extends iGeneralModel, CrosswordPlayer {
  id: string;
  _id: string;
}

export const CrosswordPlayerSchema = new mongoose.Schema<iCrosswordPlayerModel>(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    hidden: { type: Boolean, default: false },
    firstSeen: { type: Number, required: true },
    lastSeen: { type: Number, required: true },
  },
  mongoTimestamps,
);

CrosswordPlayerSchema.index({ lastSeen: -1 }, { name: "crossword_player_seen_ix" });

export const getCrosswordPlayerModel = (conn: Connection) =>
  getModel<iCrosswordPlayerModel>(conn, "CrosswordPlayer", CrosswordPlayerSchema);

import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { CrosswordGame } from "../crossword";

/**
 * The live game, one per scene, keyed by scene id (docs/crossword-mode-plan.md
 * §4.2). Worker-owned: saved on every change and reloaded at boot so a restart
 * resumes mid-puzzle. `pub` is the stored public projection the state route
 * serves. The record-shaped fields (solved, scores) have dynamic keys, so they
 * and `pub` are Mixed; the repo always writes the whole game.
 */
export interface iCrosswordGameModel extends iGeneralModel, Omit<CrosswordGame, "sceneId"> {
  id: string;
  _id: string;
}

const Mixed = mongoose.Schema.Types.Mixed;

export const CrosswordGameSchema = new mongoose.Schema<iCrosswordGameModel>(
  {
    id: { type: String, required: true, unique: true },
    puzzleId: { type: String, default: "" },
    puzzleNo: { type: Number, default: 0 },
    seq: { type: Number, default: 0 },
    phase: { type: String, required: true, enum: ["idle", "intro", "playing", "finale"], default: "idle" },
    phaseEndsAt: { type: Number, default: 0 },
    puzzleStartedAt: { type: Number, default: 0 },
    spotlight: { type: Mixed, default: null },
    hints: { type: Mixed, default: () => [] },
    solved: { type: Mixed, default: () => ({}) },
    scores: { type: Mixed, default: () => ({}) },
    feed: { type: Mixed, default: () => [] },
    paused: { type: Boolean, default: false },
    pub: { type: Mixed, default: null },
  },
  { ...mongoTimestamps, minimize: false },
);

export const getCrosswordGameModel = (conn: Connection) =>
  getModel<iCrosswordGameModel>(conn, "CrosswordGame", CrosswordGameSchema);

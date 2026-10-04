import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { CrosswordSolve } from "../crossword-records";

/**
 * Append-only solve log (docs/crossword-mode-plan.md §4.6, §9): one row per
 * word a player took. The today and all-time boards aggregate it. Host reveals
 * are not logged (they score nothing).
 */
export interface iCrosswordSolveModel extends iGeneralModel, CrosswordSolve {
  id: string;
  _id: string;
}

export const CrosswordSolveSchema = new mongoose.Schema<iCrosswordSolveModel>(
  {
    id: { type: String, required: true, unique: true },
    sceneId: { type: String, required: true },
    puzzleId: { type: String, required: true },
    entryId: { type: String, required: true },
    playerId: { type: String, required: true },
    name: { type: String, required: true },
    points: { type: Number, required: true },
    at: { type: Number, required: true },
    late: { type: Boolean },
    sim: { type: Boolean },
  },
  mongoTimestamps,
);

CrosswordSolveSchema.index({ sceneId: 1, at: -1 }, { name: "crossword_solve_scene_at_ix" });
CrosswordSolveSchema.index({ playerId: 1, at: -1 }, { name: "crossword_solve_player_ix" });
CrosswordSolveSchema.index({ at: -1 }, { name: "crossword_solve_at_ix" });

export const getCrosswordSolveModel = (conn: Connection) =>
  getModel<iCrosswordSolveModel>(conn, "CrosswordSolve", CrosswordSolveSchema);

import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { CrosswordPuzzle } from "../crossword";

/**
 * Built puzzles — the stock (docs/crossword-mode-plan.md §4.1, §9). Holds the
 * answers, so only the worker and admin routes read it. Every nested field is
 * spelled out: the schema is strict (crossword-puzzle-repo.test.ts round-trips
 * a full puzzle to prove nothing is dropped).
 */
export interface iCrosswordPuzzleModel extends iGeneralModel, Omit<CrosswordPuzzle, "id"> {
  id: string;
  _id: string;
}

const sub = (def: mongoose.SchemaDefinition) => new mongoose.Schema(def, { _id: false });

const EntrySchema = sub({
  id: { type: String, required: true },
  num: { type: Number, required: true },
  dir: { type: String, required: true, enum: ["across", "down"] },
  row: { type: Number, required: true },
  col: { type: Number, required: true },
  answer: { type: String, required: true },
  clue: { type: String, required: true },
  wordId: { type: String, default: "" },
  clueId: { type: String, default: "" },
});

const PlaySchema = sub({
  sceneId: { type: String, required: true },
  startedAt: { type: Number, required: true },
  endedAt: { type: Number },
});

export const CrosswordPuzzleSchema = new mongoose.Schema<iCrosswordPuzzleModel>(
  {
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    entries: { type: [EntrySchema], default: [] },
    status: { type: String, required: true, enum: ["ready", "rejected"], default: "ready" },
    familyFriendly: { type: Boolean, required: true, default: false },
    source: { type: String, required: true, enum: ["seed", "bank", "themed"], default: "bank" },
    createdAt: { type: Number, required: true },
    plays: { type: [PlaySchema], default: [] },
  },
  mongoTimestamps,
);

CrosswordPuzzleSchema.index({ status: 1, createdAt: 1 }, { name: "crossword_puzzle_status_ix" });
CrosswordPuzzleSchema.index({ "plays.sceneId": 1, "plays.startedAt": -1 }, { name: "crossword_puzzle_plays_ix" });

export const getCrosswordPuzzleModel = (conn: Connection) =>
  getModel<iCrosswordPuzzleModel>(conn, "CrosswordPuzzle", CrosswordPuzzleSchema);

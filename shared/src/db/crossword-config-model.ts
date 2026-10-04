import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import { DEFAULT_CROSSWORD_CONFIG, type CrosswordConfig } from "../crossword";

/**
 * One crossword-config document PER SCENE, keyed by the scene id — the
 * DirectorConfig pattern (docs/crossword-mode-plan.md §4.4, §9). Read through
 * `db.getOrInitCrosswordConfig`, which merges over DEFAULT_CROSSWORD_CONFIG.
 */
export interface iCrosswordConfigModel extends iGeneralModel, CrosswordConfig {
  id: string;
  _id: string;
}

const D = DEFAULT_CROSSWORD_CONFIG;
const num = (v: number) => ({ type: Number, default: v });
const bool = (v: boolean) => ({ type: Boolean, default: v });

export const CrosswordConfigSchema = new mongoose.Schema<iCrosswordConfigModel>(
  {
    id: { type: String, required: true, unique: true },
    enabled: bool(D.enabled),
    playOffAir: bool(D.playOffAir),
    introS: num(D.introS),
    clueS: num(D.clueS),
    finaleS: num(D.finaleS),
    revealHoldS: num(D.revealHoldS),
    solveBeatS: num(D.solveBeatS),
    ceilingMin: num(D.ceilingMin),
    hintStartFrac: num(D.hintStartFrac),
    hintMaxFrac: num(D.hintMaxFrac),
    minZipf: num(D.minZipf),
    themes: { type: [String], default: [] },
    themeEvery: num(D.themeEvery),
    minWords: num(D.minWords),
    maxWords: num(D.maxWords),
    maxSize: num(D.maxSize),
    stockTarget: num(D.stockTarget),
    autoApprove: bool(D.autoApprove),
    noRepeatPuzzles: num(D.noRepeatPuzzles),
    noRepeatWordsPuzzles: num(D.noRepeatWordsPuzzles),
    streamDelayS: num(D.streamDelayS),
    rateMax: num(D.rateMax),
    rateWindowS: num(D.rateWindowS),
    blocklist: { type: [String], default: [] },
  },
  mongoTimestamps,
);

export const getCrosswordConfigModel = (conn: Connection) =>
  getModel<iCrosswordConfigModel>(conn, "CrosswordConfig", CrosswordConfigSchema);

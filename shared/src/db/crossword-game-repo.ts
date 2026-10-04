import type { Model } from "mongoose";
import type { CrosswordGame, CrosswordPublicState } from "../crossword";
import type { iCrosswordGameModel } from "./crossword-game-model";

function toGame(d: iCrosswordGameModel): CrosswordGame {
  return {
    sceneId: d.id,
    puzzleId: d.puzzleId ?? "",
    puzzleNo: d.puzzleNo ?? 0,
    seq: d.seq ?? 0,
    phase: d.phase,
    phaseEndsAt: d.phaseEndsAt ?? 0,
    puzzleStartedAt: d.puzzleStartedAt ?? 0,
    spotlight: d.spotlight ?? null,
    hints: d.hints ?? [],
    solved: d.solved ?? {},
    scores: d.scores ?? {},
    feed: d.feed ?? [],
    paused: !!d.paused,
    pub: d.pub,
  };
}

/**
 * Live games (`db.crosswordGames`), one per scene keyed by scene id. The
 * worker writes the whole game on every change; the public state route reads
 * only `pub` (`getPublic`), so the answers stay in the worker.
 */
export function makeCrosswordGameRepo(model: Model<iCrosswordGameModel>) {
  return {
    model,

    async get(sceneId: string): Promise<CrosswordGame | null> {
      const doc = await model.findOne({ id: sceneId }).lean().exec();
      return doc ? toGame(doc as iCrosswordGameModel) : null;
    },

    /** The stored public projection only, or null. */
    async getPublic(sceneId: string): Promise<CrosswordPublicState | null> {
      const doc = await model.findOne({ id: sceneId }, { pub: 1 }).lean().exec();
      return ((doc as { pub?: CrosswordPublicState } | null)?.pub ?? null) as CrosswordPublicState | null;
    },

    /** Write the whole game. */
    async save(game: CrosswordGame): Promise<void> {
      const { sceneId, ...rest } = game;
      await model.updateOne({ id: sceneId }, { $set: rest, $setOnInsert: { id: sceneId } }, { upsert: true }).exec();
    },

    async remove(sceneId: string): Promise<boolean> {
      const res = await model.deleteOne({ id: sceneId }).exec();
      return (res.deletedCount ?? 0) > 0;
    },
  };
}

export type CrosswordGameRepo = ReturnType<typeof makeCrosswordGameRepo>;

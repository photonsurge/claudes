import type { Model, PipelineStage } from "mongoose";
import type { CrosswordBoardRow, CrosswordSolve } from "../crossword-records";
import type { iCrosswordSolveModel } from "./crossword-solve-model";

/**
 * The append-only solve log (`db.crosswordSolves`) and the boards built from it.
 * `board` excludes `hiddenIds` (players hidden on the Players page).
 */
export function makeCrosswordSolveRepo(model: Model<iCrosswordSolveModel>) {
  return {
    model,

    async append(s: CrosswordSolve): Promise<void> {
      await model.create(s);
    },

    /**
     * Points and words per player, best first. `sceneId` scopes to one channel,
     * `since` to solves at or after that time (the today board).
     */
    async board(
      opts: { sceneId?: string; since?: number; limit?: number; hiddenIds?: string[]; includeSim?: boolean } = {},
    ): Promise<CrosswordBoardRow[]> {
      const match: Record<string, unknown> = {};
      if (opts.sceneId) match.sceneId = opts.sceneId;
      if (typeof opts.since === "number") match.at = { $gte: opts.since };
      if (opts.hiddenIds?.length) match.playerId = { $nin: opts.hiddenIds };
      if (opts.includeSim === false) match.sim = { $ne: true };
      const pipeline: PipelineStage[] = [
        { $match: match },
        { $sort: { at: 1 } },
        { $group: { _id: "$playerId", name: { $last: "$name" }, points: { $sum: "$points" }, words: { $sum: 1 } } },
        { $sort: { points: -1, words: -1, name: 1 } },
      ];
      if (opts.limit) pipeline.push({ $limit: opts.limit });
      const rows = await model.aggregate(pipeline).exec();
      return rows.map((r: any) => ({ playerId: r._id, name: r.name, points: r.points, words: r.words }));
    },

    /** Recent solves, newest first. */
    async recent(opts: { sceneId?: string; playerId?: string; limit?: number } = {}): Promise<CrosswordSolve[]> {
      const filter: Record<string, unknown> = {};
      if (opts.sceneId) filter.sceneId = opts.sceneId;
      if (opts.playerId) filter.playerId = opts.playerId;
      const docs = await model.find(filter, { _id: 0, __v: 0, created: 0, updated: 0 }).sort({ at: -1 }).limit(opts.limit ?? 50).lean().exec();
      return docs as unknown as CrosswordSolve[];
    },
  };
}

export type CrosswordSolveRepo = ReturnType<typeof makeCrosswordSolveRepo>;

import type { Model } from "mongoose";
import type { CrosswordPlayer } from "../crossword-records";
import type { iCrosswordPlayerModel } from "./crossword-player-model";

const toPlayer = (d: iCrosswordPlayerModel): CrosswordPlayer => ({
  id: d.id,
  name: d.name,
  hidden: !!d.hidden,
  firstSeen: d.firstSeen,
  lastSeen: d.lastSeen,
});

/** Players (`db.crosswordPlayers`): one row per id, touched on every answer. */
export function makeCrosswordPlayerRepo(model: Model<iCrosswordPlayerModel>) {
  return {
    model,

    /** Upsert a player seen at `at` under `name`; returns it (hidden flag included). */
    async touch(id: string, name: string, at: number): Promise<CrosswordPlayer> {
      const doc = await model
        .findOneAndUpdate(
          { id },
          { $set: { name, lastSeen: at }, $setOnInsert: { id, firstSeen: at, hidden: false } },
          { upsert: true, new: true },
        )
        .lean()
        .exec();
      return toPlayer(doc as iCrosswordPlayerModel);
    },

    async get(id: string): Promise<CrosswordPlayer | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? toPlayer(doc as iCrosswordPlayerModel) : null;
    },

    /** Players, most recently seen first. */
    async list(opts: { limit?: number; search?: string } = {}): Promise<CrosswordPlayer[]> {
      const filter: Record<string, unknown> = {};
      if (opts.search) filter.name = { $regex: opts.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      const docs = await model.find(filter).sort({ lastSeen: -1 }).limit(opts.limit ?? 200).lean().exec();
      return docs.map((d) => toPlayer(d as iCrosswordPlayerModel));
    },

    async setHidden(id: string, hidden: boolean): Promise<boolean> {
      const res = await model.updateOne({ id }, { $set: { hidden } }).exec();
      return (res.matchedCount ?? 0) > 0;
    },

    /** Ids of hidden players. */
    async hiddenIds(): Promise<string[]> {
      const docs = await model.find({ hidden: true }, { id: 1 }).lean().exec();
      return docs.map((d) => (d as { id: string }).id);
    },
  };
}

export type CrosswordPlayerRepo = ReturnType<typeof makeCrosswordPlayerRepo>;

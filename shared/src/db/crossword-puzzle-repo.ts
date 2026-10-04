import type { Model } from "mongoose";
import type { CrosswordEntry, CrosswordPlay, CrosswordPuzzle, CrosswordPuzzleStatus } from "../crossword";
import type { iCrosswordPuzzleModel } from "./crossword-puzzle-model";

function toPuzzle(d: iCrosswordPuzzleModel): CrosswordPuzzle {
  return {
    id: d.id,
    title: d.title,
    width: d.width,
    height: d.height,
    entries: (d.entries ?? []).map((e: CrosswordEntry) => ({
      id: e.id,
      num: e.num,
      dir: e.dir,
      row: e.row,
      col: e.col,
      answer: e.answer,
      clue: e.clue,
      wordId: e.wordId ?? "",
      clueId: e.clueId ?? "",
    })),
    // A puzzle stored by the first build may say "draft": it was never approved.
    status: d.status === "ready" ? "ready" : "rejected",
    familyFriendly: d.familyFriendly === true,
    source: d.source,
    createdAt: d.createdAt,
    plays: (d.plays ?? []).map((x: CrosswordPlay) => ({
      sceneId: x.sceneId,
      startedAt: x.startedAt,
      ...(typeof x.endedAt === "number" ? { endedAt: x.endedAt } : {}),
    })),
    ...(d.unapproved === true ? { unapproved: true } : {}),
  };
}

/** Fields an upsert writes. Never `plays`: those belong to the runner. */
const setDoc = (p: CrosswordPuzzle) => ({
  title: p.title,
  width: p.width,
  height: p.height,
  entries: p.entries,
  status: p.status,
  familyFriendly: p.familyFriendly === true,
  source: p.source,
  createdAt: p.createdAt,
  unapproved: p.unapproved === true,
});

/** Filter for puzzles whose entries use a bank word or clue; null when neither id is given. */
function containing(ref: { wordId?: string; clueId?: string }): Record<string, unknown> | null {
  if (ref.wordId) return { "entries.wordId": ref.wordId };
  if (ref.clueId) return { "entries.clueId": ref.clueId };
  return null;
}

/**
 * Puzzle stock (`db.crosswordPuzzles`). Holds the answers: only the worker and
 * admin routes may read it.
 */
export function makeCrosswordPuzzleRepo(model: Model<iCrosswordPuzzleModel>) {
  return {
    model,

    /** Puzzles, newest first, optionally by status. */
    async list(opts: { status?: CrosswordPuzzleStatus | CrosswordPuzzleStatus[]; limit?: number } = {}): Promise<CrosswordPuzzle[]> {
      const filter: Record<string, unknown> = {};
      if (opts.status) filter.status = Array.isArray(opts.status) ? { $in: opts.status } : opts.status;
      const docs = await model.find(filter).sort({ createdAt: -1 }).limit(opts.limit ?? 0).lean().exec();
      return docs.map((d) => toPuzzle(d as iCrosswordPuzzleModel));
    },

    /** One puzzle by id, or null. */
    async get(id: string): Promise<CrosswordPuzzle | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? toPuzzle(doc as iCrosswordPuzzleModel) : null;
    },

    /** Create or replace a puzzle by id (keeps its plays). */
    async upsert(p: CrosswordPuzzle): Promise<CrosswordPuzzle> {
      await model.updateOne({ id: p.id }, { $set: setDoc(p), $setOnInsert: { id: p.id, plays: [] } }, { upsert: true }).exec();
      return (await this.get(p.id)) ?? p;
    },

    async setStatus(id: string, status: CrosswordPuzzleStatus): Promise<boolean> {
      const res = await model.updateOne({ id }, { $set: { status } }).exec();
      return (res.matchedCount ?? 0) > 0;
    },

    async setFamilyFriendly(id: string, familyFriendly: boolean): Promise<boolean> {
      const res = await model.updateOne({ id }, { $set: { familyFriendly } }).exec();
      return (res.matchedCount ?? 0) > 0;
    },

    async remove(id: string): Promise<boolean> {
      const res = await model.deleteOne({ id }).exec();
      return (res.deletedCount ?? 0) > 0;
    },

    /** Record that a scene started playing this puzzle (appends; one atomic op). */
    async startPlay(id: string, sceneId: string, startedAt: number): Promise<boolean> {
      const res = await model.updateOne({ id }, { $push: { plays: { sceneId, startedAt } } }).exec();
      return (res.matchedCount ?? 0) > 0;
    },

    /** Stamp `endedAt` on that scene's open play started at `startedAt`. */
    async endPlay(id: string, sceneId: string, startedAt: number, endedAt: number): Promise<boolean> {
      const res = await model
        .updateOne(
          { id },
          { $set: { "plays.$[p].endedAt": endedAt } },
          { arrayFilters: [{ "p.sceneId": sceneId, "p.startedAt": startedAt }] },
        )
        .exec();
      return (res.matchedCount ?? 0) > 0;
    },

    /** Ids of puzzles (optionally only those with `status`) that use this bank word or clue. */
    async idsContaining(ref: { wordId?: string; clueId?: string }, status?: CrosswordPuzzleStatus): Promise<string[]> {
      const filter = containing(ref);
      if (!filter) return [];
      if (status) filter.status = status;
      const docs = await model.find(filter, { id: 1 }).lean().exec();
      return (docs as { id: string }[]).map((d) => d.id);
    },

    /**
     * Set fields on every puzzle that uses this bank word or clue (optionally
     * only those with `status`). Returns the ids it changed.
     */
    async updateContaining(
      ref: { wordId?: string; clueId?: string },
      set: { status?: CrosswordPuzzleStatus; familyFriendly?: boolean },
      status?: CrosswordPuzzleStatus,
    ): Promise<string[]> {
      const ids = await this.idsContaining(ref, status);
      if (!ids.length) return [];
      await model.updateMany({ id: { $in: ids } }, { $set: set }).exec();
      return ids;
    },

    /**
     * The scene's last `n` played puzzles, most recent first — for the
     * candidate pick's no-repeat window on words.
     */
    async recentForScene(sceneId: string, n: number): Promise<CrosswordPuzzle[]> {
      if (n <= 0) return [];
      const docs = await model.find({ "plays.sceneId": sceneId }).lean().exec();
      const last = (d: iCrosswordPuzzleModel) =>
        Math.max(...(d.plays ?? []).filter((p) => p.sceneId === sceneId).map((p) => p.startedAt));
      return (docs as iCrosswordPuzzleModel[])
        .sort((a, b) => last(b) - last(a))
        .slice(0, n)
        .map(toPuzzle);
    },
  };
}

export type CrosswordPuzzleRepo = ReturnType<typeof makeCrosswordPuzzleRepo>;

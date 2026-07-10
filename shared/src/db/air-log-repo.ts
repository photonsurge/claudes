import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type {
  AirEntryEndReason,
  AirRunEndReason,
  iAirEntry,
  iAirEntryModel,
  iAirRun,
  iAirRunModel,
} from "./air-log-model";

const strip = <T>(doc: any): T => {
  const { __v, _id, ...rest } = doc;
  return rest as T;
};

/** Everything the worker knows about a cut at the instant it happens. */
export type AirCut = Omit<iAirEntry, "id" | "created" | "updated" | "endedAt" | "actualMs" | "endReason">;

/**
 * The as-run log persistence. One writer (the worker's director loop), one
 * reader (/admin/runs). A cut both opens the new entry and closes the previous
 * open one — entries therefore never overlap and the last one of a run is
 * closed by `endRun` (or by the next session's `startRun` finding the run
 * dangling after a worker restart).
 */
export function makeAirLogRepo(runModel: Model<iAirRunModel>, entryModel: Model<iAirEntryModel>) {
  /** Close every still-open entry of a run at `at` with the given reason. */
  async function closeOpenEntries(runId: string, at: Date, reason: AirEntryEndReason): Promise<void> {
    const open = await entryModel.find({ runId, endedAt: null }).lean().exec();
    for (const e of open) {
      await entryModel
        .updateOne(
          { id: e.id },
          { $set: { endedAt: at, actualMs: Math.max(0, at.getTime() - new Date(e.startedAt).getTime()), endReason: reason } },
        )
        .exec();
    }
  }

  async function closeRun(runId: string, at: Date, reason: AirRunEndReason): Promise<void> {
    await closeOpenEntries(runId, at, "run-ended");
    await runModel.updateOne({ id: runId }, { $set: { endedAt: at, endReason: reason } }).exec();
  }

  return {
    runModel,
    entryModel,

    /**
     * Open a new run for a scene. Any run still open for that scene is a
     * leftover from a previous process (the loop keeps at most one live run
     * per scene), so it's closed as `stale` first.
     */
    async startRun(sceneId: string, at: Date): Promise<string> {
      const dangling = await runModel.find({ sceneId, endedAt: null }).lean().exec();
      for (const run of dangling) await closeRun(run.id, at, "stale");
      const id = uuidv4();
      await runModel.create({ id, sceneId, startedAt: at, cuts: 0, kindCounts: {} });
      return id;
    },

    /** Close a run (operator turned auto off) and its still-open entry. */
    async endRun(runId: string, at: Date): Promise<void> {
      await closeRun(runId, at, "auto-off");
    },

    /**
     * Record one cut: closes the run's previous open entry at the cut instant
     * (`prevEndReason` says whether it expired naturally or was skipped) and
     * opens the new entry, bumping the run's tallies.
     */
    async recordCut(cut: AirCut, prevEndReason: AirEntryEndReason): Promise<void> {
      await closeOpenEntries(cut.runId, cut.startedAt, prevEndReason);
      await entryModel.create({ id: uuidv4(), ...cut });
      await runModel
        .updateOne(
          { id: cut.runId },
          { $inc: { cuts: 1, [`kindCounts.${cut.kind}`]: 1 }, $set: { lastCutAt: cut.startedAt } },
        )
        .exec();
    },

    /** Runs newest-first, optionally for one scene. No default cap. */
    async listRuns(opts: { sceneId?: string; limit?: number } = {}): Promise<iAirRun[]> {
      const query: Record<string, unknown> = {};
      if (opts.sceneId) query.sceneId = opts.sceneId;
      let q = runModel.find(query).sort({ startedAt: -1 });
      if (opts.limit && opts.limit > 0) q = q.limit(opts.limit);
      const docs = await q.lean().exec();
      return docs.map((d) => strip<iAirRun>(d));
    },

    /** One run by id, or null. */
    async getRun(id: string): Promise<iAirRun | null> {
      const doc = await runModel.findOne({ id }).lean().exec();
      return doc ? strip<iAirRun>(doc) : null;
    },

    /** A run's full timeline, in air order. */
    async listEntries(runId: string): Promise<iAirEntry[]> {
      const docs = await entryModel.find({ runId }).sort({ seq: 1 }).lean().exec();
      return docs.map((d) => strip<iAirEntry>(d));
    },

    /**
     * Every airing of one subject across all runs, newest-first — e.g.
     * "storm:nws:XYZ" for an alert's "when did this air" panel.
     */
    async listEntriesForSegment(segmentId: string, limit = 0): Promise<iAirEntry[]> {
      let q = entryModel.find({ segmentId }).sort({ startedAt: -1 });
      if (limit > 0) q = q.limit(limit);
      const docs = await q.lean().exec();
      return docs.map((d) => strip<iAirEntry>(d));
    },

    /**
     * A scene's most-recently-aired shots, newest-first, spanning run
     * boundaries (sorted by air time, not grouped by run). Backs the operator's
     * live "recently aired" glance on /control — it reads this durable log so it
     * survives reloads and never misses a cut, unlike the old client-only
     * session tracker that only saw cuts while the page happened to be open.
     */
    async recentEntries(opts: { sceneId: string; limit?: number }): Promise<iAirEntry[]> {
      const limit = opts.limit && opts.limit > 0 ? opts.limit : 12;
      const docs = await entryModel
        .find({ sceneId: opts.sceneId })
        .sort({ startedAt: -1 })
        .limit(limit)
        .lean()
        .exec();
      return docs.map((d) => strip<iAirEntry>(d));
    },
  };
}

export type AirLogRepo = ReturnType<typeof makeAirLogRepo>;

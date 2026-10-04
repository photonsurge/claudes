import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { CommandSource, CommandStatus, DirectorCommand, DirectorOp } from "../director-commands";
import { COMMAND_RETENTION_MS, type iDirectorCommand } from "./director-command-model";

const strip = (doc: Record<string, unknown>): DirectorCommand => {
  const { __v, _id, created, updated, purgeAt, ...rest } = doc;
  return rest as unknown as DirectorCommand;
};

/**
 * The director command queue. Two writers (the admin route for operators, the
 * worker's chat handler for viewers), one consumer (the director loop).
 */
export function makeDirectorCommandRepo(model: Model<iDirectorCommand>) {
  return {
    model,

    /** Add a command to a scene's queue. `status` other than "queued" records a
     *  request refused at the door (e.g. the director is off). */
    async enqueue(input: {
      sceneId: string;
      source: CommandSource;
      cmd: DirectorOp;
      now: number;
      ttlMs: number;
      status?: CommandStatus;
      note?: string;
      viewer?: DirectorCommand["viewer"];
    }): Promise<DirectorCommand> {
      const status = input.status ?? "queued";
      const doc: iDirectorCommand = {
        id: uuidv4(),
        sceneId: input.sceneId,
        source: input.source,
        cmd: input.cmd,
        status,
        createdAt: input.now,
        expiresAt: input.now + input.ttlMs,
        ...(input.note ? { note: input.note } : {}),
        ...(input.viewer ? { viewer: input.viewer } : {}),
        ...(status !== "queued" ? { purgeAt: new Date(input.now + COMMAND_RETENTION_MS) } : {}),
      } as iDirectorCommand;
      await model.create(doc);
      return strip(doc as unknown as Record<string, unknown>);
    },

    /** A scene's queued commands, oldest first. */
    async pending(sceneId: string): Promise<DirectorCommand[]> {
      const docs = await model.find({ sceneId, status: "queued" }).sort({ createdAt: 1 }).lean().exec();
      return (docs as Record<string, unknown>[]).map(strip);
    },

    /** Settle one queued command. A row that is no longer queued is left alone. */
    async settle(
      id: string,
      status: Exclude<CommandStatus, "queued">,
      extra: { note?: string; resolved?: { id: string; title: string }; appliedAt?: number; appliedSeq?: number; now: number },
    ): Promise<boolean> {
      const { now, ...rest } = extra;
      const $set: Record<string, unknown> = { status, purgeAt: new Date(now + COMMAND_RETENTION_MS) };
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) $set[k] = v;
      const res = await model.updateOne({ id, status: "queued" }, { $set }).exec();
      return (res.modifiedCount ?? 0) > 0;
    },

    /** Drop every queued command for a scene (operator / mod "clear"). */
    async clearQueued(sceneId: string, now: number, note = "cleared"): Promise<number> {
      const res = await model
        .updateMany(
          { sceneId, status: "queued" },
          { $set: { status: "dropped", note, purgeAt: new Date(now + COMMAND_RETENTION_MS) } },
        )
        .exec();
      return res.modifiedCount ?? 0;
    },

    /** Drop one queued command. */
    async drop(id: string, now: number): Promise<boolean> {
      return this.settle(id, "dropped", { note: "dropped by the operator", now });
    },

    /** A scene's command log, newest first. */
    async recent(sceneId: string, opts: { since?: number; limit?: number } = {}): Promise<DirectorCommand[]> {
      const query: Record<string, unknown> = { sceneId };
      if (opts.since && opts.since > 0) query.createdAt = { $gt: opts.since };
      const docs = await model
        .find(query)
        .sort({ createdAt: -1 })
        .limit(opts.limit && opts.limit > 0 ? Math.min(opts.limit, 200) : 50)
        .lean()
        .exec();
      return (docs as Record<string, unknown>[]).map(strip);
    },

    /** One command by id. */
    async get(id: string): Promise<DirectorCommand | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? strip(doc as Record<string, unknown>) : null;
    },
  };
}

export type DirectorCommandRepo = ReturnType<typeof makeDirectorCommandRepo>;

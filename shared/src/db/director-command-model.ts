import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { DirectorCommand } from "../director-commands";

/**
 * One director command (shared/director-commands.ts) — the per-scene queue the
 * worker's director loop drains every tick. Written by the admin route
 * (operator) and the worker's chat handler (viewers).
 *
 * Settled rows get `purgeAt` (7 days on) and a TTL index removes them; the
 * as-run log keeps what matters about a command that aired.
 */
export interface iDirectorCommand extends Omit<iGeneralModel, "id">, DirectorCommand {
  /** Set when the row settles; the TTL index deletes it after this time. */
  purgeAt?: Date;
}

export const COMMAND_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const DirectorCommandSchema = new mongoose.Schema<iDirectorCommand>(
  {
    id: { type: String, required: true, unique: true },
    sceneId: { type: String, required: true },
    // Union-shaped (operator / viewer / system) — every field optional, `kind` decides.
    source: {
      kind: { type: String, required: true, enum: ["operator", "viewer", "system"] },
      user: { type: String, required: false },
      platform: { type: String, required: false },
      author: { type: String, required: false },
      isMod: { type: Boolean, required: false },
      job: { type: String, required: false },
    },
    // The op is a validated union (validateOp); stored as-is.
    cmd: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, required: true, enum: ["queued", "applied", "refused", "expired", "dropped"], default: "queued" },
    note: { type: String, required: false },
    resolved: {
      type: new mongoose.Schema({ id: { type: String, required: true }, title: { type: String, required: true } }, { _id: false }),
      required: false,
    },
    createdAt: { type: Number, required: true },
    expiresAt: { type: Number, required: true },
    appliedAt: { type: Number, required: false },
    appliedSeq: { type: Number, required: false },
    viewer: {
      type: new mongoose.Schema(
        {
          everyS: { type: Number, required: true },
          immediate: { type: Boolean, required: true },
          allowCities: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      required: false,
    },
    purgeAt: { type: Date, required: false },
  },
  mongoTimestamps,
);

// The loop's per-tick read: a scene's queued rows, oldest first.
DirectorCommandSchema.index({ sceneId: 1, status: 1, createdAt: 1 }, { name: "dircmd_scene_status_ix" });
// The command log: a scene's rows newest first.
DirectorCommandSchema.index({ sceneId: 1, createdAt: -1 }, { name: "dircmd_scene_recent_ix" });
DirectorCommandSchema.index({ purgeAt: 1 }, { name: "dircmd_ttl_ix", expireAfterSeconds: 0 });

export const getDirectorCommandModel = (conn: Connection) =>
  getModel<iDirectorCommand>(conn, "DirectorCommand", DirectorCommandSchema);

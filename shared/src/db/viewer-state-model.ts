import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ViewerState } from "../viewer";

/**
 * One viewer-state doc per scene (shared/viewer.ts): the music / palette picks
 * viewers made from chat, written by the worker's chat handler and sweep.
 * Persisted so a worker restart keeps the holds.
 */
export interface iViewerState extends Omit<iGeneralModel, "id">, ViewerState {}

export const ViewerStateSchema = new mongoose.Schema<iViewerState>(
  {
    sceneId: { type: String, required: true, unique: true },
    // Small, fully worker-owned shapes, rebuilt whole on every write.
    active: { type: mongoose.Schema.Types.Mixed, default: {} },
    queue: { type: mongoose.Schema.Types.Mixed, default: [] },
    audioSkipEpoch: { type: Number, required: true, default: 0 },
    audioSeed: { type: Number, required: true, default: 0 },
    updatedAt: { type: Number, required: true, default: 0 },
  },
  { ...mongoTimestamps, minimize: false },
);

// The sweep's read: scenes with something on air or waiting.
ViewerStateSchema.index({ updatedAt: -1 }, { name: "viewer_state_updated_ix" });

export const getViewerStateModel = (conn: Connection) => getModel<iViewerState>(conn, "ViewerState", ViewerStateSchema);

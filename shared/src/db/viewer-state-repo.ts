import type { Model } from "mongoose";
import { emptyViewerState, type ViewerState } from "../viewer";
import type { iViewerState } from "./viewer-state-model";

const strip = (doc: Record<string, unknown>): ViewerState => {
  const { __v, _id, created, updated, ...rest } = doc;
  return rest as unknown as ViewerState;
};

/** The viewer-state store — one doc per scene, written only by the worker. */
export function makeViewerStateRepo(model: Model<iViewerState>) {
  return {
    model,

    /** A scene's viewer state (an empty one when none was ever written). */
    async get(sceneId: string): Promise<ViewerState> {
      const doc = await model.findOne({ sceneId }).lean().exec();
      return doc ? strip(doc as Record<string, unknown>) : emptyViewerState(sceneId);
    },

    /** Replace a scene's viewer state. */
    async save(state: ViewerState): Promise<void> {
      await model
        .updateOne(
          { sceneId: state.sceneId },
          {
            $set: {
              active: state.active,
              queue: state.queue,
              audioSkipEpoch: state.audioSkipEpoch,
              audioSeed: state.audioSeed,
              updatedAt: state.updatedAt,
            },
          },
          { upsert: true },
        )
        .exec();
    },

    /** Scenes that may have something to sweep: a pick on air or waiting. */
    async withPicks(): Promise<ViewerState[]> {
      const docs = await model
        .find({ $or: [{ "queue.0": { $exists: true } }, { "active.audioMode": { $exists: true } }, { "active.theme": { $exists: true } }] })
        .lean()
        .exec();
      return (docs as Record<string, unknown>[]).map(strip);
    },
  };
}

export type ViewerStateRepo = ReturnType<typeof makeViewerStateRepo>;

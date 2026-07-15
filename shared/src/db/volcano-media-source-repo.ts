import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { VolcanoMediaSource } from "../volcanoes/media";
import type { iVolcanoMediaSource, iVolcanoMediaSourceModel } from "./volcano-media-source-model";

export function makeVolcanoMediaSourceRepo(model: Model<iVolcanoMediaSourceModel>) {
  return {
    model,
    /**
     * Register/refresh an adapter's definition. `enabled` is deliberately NOT in
     * the `$set`: it is the OPERATOR's switch, and the registry seed re-runs on
     * every boot with `enabled: true`. Setting it here would flip a source the
     * operator turned off straight back on. Seed the default on insert only.
     */
    async upsert(source: Omit<iVolcanoMediaSource, "id">): Promise<void> {
      const { enabled, ...definition } = source;
      await model.updateOne(
        { source: source.source },
        { $set: definition, $setOnInsert: { id: uuidv4(), enabled } },
        { upsert: true },
      ).exec();
    },
    /** The operator's switch — the only writer of `enabled`. */
    async setEnabled(source: VolcanoMediaSource, enabled: boolean): Promise<void> {
      await model.updateOne({ source }, { $set: { enabled } }).exec();
    },
    async list(): Promise<iVolcanoMediaSource[]> {
      const docs = await model.find({}).sort({ source: 1 }).lean().exec();
      return docs.map((doc: any) => { const { _id, __v, ...rest } = doc; return rest; });
    },
    /** Sources the operator has left switched on — the gate for every media job. */
    async listEnabledSources(): Promise<VolcanoMediaSource[]> {
      const docs = await model.find({ enabled: true }, { source: 1 }).lean().exec();
      return docs.map((doc: any) => doc.source as VolcanoMediaSource);
    },
  };
}

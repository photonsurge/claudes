import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iVolcanoMediaSource, iVolcanoMediaSourceModel } from "./volcano-media-source-model";

export function makeVolcanoMediaSourceRepo(model: Model<iVolcanoMediaSourceModel>) {
  return {
    model,
    async upsert(source: Omit<iVolcanoMediaSource, "id">): Promise<void> {
      await model.updateOne({ source: source.source }, { $set: source, $setOnInsert: { id: uuidv4() } }, { upsert: true }).exec();
    },
    async list(): Promise<iVolcanoMediaSource[]> {
      const docs = await model.find({}).sort({ source: 1 }).lean().exec();
      return docs.map((doc: any) => { const { _id, __v, ...rest } = doc; return rest; });
    },
  };
}

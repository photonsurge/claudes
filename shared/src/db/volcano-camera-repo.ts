import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { iVolcanoCameraModel } from "./volcano-camera-model";
import type { VolcanoCamera } from "../volcanoes/media";

const clean = (d: any): VolcanoCamera => { const { _id, __v, ...rest } = d; return rest; };

export function makeVolcanoCameraRepo(model: Model<iVolcanoCameraModel>) {
  return {
    model,
    async upsertMany(cameras: Omit<VolcanoCamera, "id" | "firstSeenAt" | "lastSeenAt">[]) {
      if (!cameras.length) return { upserted: 0, matched: 0 };
      const now = new Date();
      const res = await model.bulkWrite(cameras.map((camera) => ({ updateOne: {
        filter: { source: camera.source, sourceCameraId: camera.sourceCameraId },
        update: { $set: { ...camera, lastSeenAt: now }, $setOnInsert: { id: uuidv4(), firstSeenAt: now } },
        upsert: true,
      } })));
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },
    async listForVolcano(volcanoId: string): Promise<VolcanoCamera[]> {
      const docs = await model.find({ volcanoId, enabled: true }).sort({ source: 1, name: 1 }).lean().exec();
      return docs.map(clean);
    },
    async listEnabled(): Promise<VolcanoCamera[]> {
      const docs = await model.find({ enabled: true }).sort({ lastSeenAt: -1 }).lean().exec();
      return docs.map(clean);
    },
    async disableMissing(source: VolcanoCamera["source"], activeSourceCameraIds: string[]): Promise<number> {
      const res = await model.updateMany({ source, enabled: true, sourceCameraId: { $nin: activeSourceCameraIds } }, { $set: { enabled: false } }).exec();
      return res.modifiedCount ?? 0;
    },
  };
}

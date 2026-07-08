import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { SeaPoint } from "../sea-points/types";
import type { iSeaPointModel } from "./sea-point-model";

const strip = (doc: any): iSeaPointModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iSeaPointModel;
};

function toSeaPoint(doc: iSeaPointModel): SeaPoint {
  return {
    pointId: doc.pointId,
    name: doc.name,
    blurb: doc.blurb,
    lat: doc.lat,
    lng: doc.lng,
    zoom: doc.zoom,
    depthCycle: doc.depthCycle,
    enabled: doc.enabled,
  };
}

const setDoc = (p: SeaPoint) => ({
  name: p.name,
  blurb: p.blurb,
  lat: p.lat,
  lng: p.lng,
  zoom: p.zoom,
  depthCycle: p.depthCycle,
  enabled: p.enabled,
  loc: { type: "Point" as const, coordinates: [p.lng, p.lat] as [number, number] },
});

/**
 * Sea-point (ocean monitoring point) persistence + admin CRUD. Upserts dedup
 * on `pointId`, so re-adding the same slug edits it in place — mirrors
 * `cam-repo.ts`'s shape.
 */
export function makeSeaPointRepo(model: Model<iSeaPointModel>) {
  return {
    model,

    /** Upsert a single point and return its canonical wire shape. */
    async upsertOne(point: SeaPoint): Promise<SeaPoint> {
      await model
        .updateOne(
          { pointId: point.pointId },
          { $set: setDoc(point), $setOnInsert: { id: uuidv4(), pointId: point.pointId } },
          { upsert: true },
        )
        .exec();
      const doc = await model.findOne({ pointId: point.pointId }).lean().exec();
      return doc ? toSeaPoint(strip(doc)) : point;
    },

    /** All sea points (admin sees disabled ones too), name-sorted. */
    async list(): Promise<SeaPoint[]> {
      const docs = await model.find({}).sort({ name: 1 }).lean().exec();
      return docs.map((d) => toSeaPoint(strip(d)));
    },

    /** A single point by pointId, or null. */
    async getByPointId(pointId: string): Promise<SeaPoint | null> {
      const doc = await model.findOne({ pointId }).lean().exec();
      return doc ? toSeaPoint(strip(doc)) : null;
    },

    /** Delete a point by pointId. Returns true if one was removed. */
    async remove(pointId: string): Promise<boolean> {
      const res = await model.deleteOne({ pointId }).exec();
      return (res.deletedCount ?? 0) > 0;
    },
  };
}

export type SeaPointRepo = ReturnType<typeof makeSeaPointRepo>;

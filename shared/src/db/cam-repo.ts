import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { Cam } from "../cams/types";
import type { iCamModel } from "./cam-model";

const strip = (doc: any): iCamModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iCamModel;
};

/** Map a stored doc back to the wire `Cam` (loc/_id/fetchedAt → epoch ms). */
export function toCam(doc: iCamModel): Cam {
  return {
    camId: doc.camId,
    provider: doc.provider,
    title: doc.title,
    lat: doc.lat,
    lng: doc.lng,
    status: doc.status,
    place: doc.place,
    country: doc.country,
    imageUrl: doc.imageUrl,
    timelapseUrl: doc.timelapseUrl,
    playerUrl: doc.playerUrl,
    live: doc.live ? { kind: doc.live.kind, url: doc.live.url } : undefined,
    tags: doc.tags && doc.tags.length ? doc.tags : undefined,
    fetchedAt: doc.fetchedAt ? new Date(doc.fetchedAt).getTime() : undefined,
  };
}

const setDoc = (c: Cam, fetchedAt: Date) => ({
  provider: c.provider,
  title: c.title,
  lat: c.lat,
  lng: c.lng,
  status: c.status,
  place: c.place,
  country: c.country,
  imageUrl: c.imageUrl,
  timelapseUrl: c.timelapseUrl,
  playerUrl: c.playerUrl,
  live: c.live,
  tags: c.tags,
  fetchedAt: c.fetchedAt ? new Date(c.fetchedAt) : fetchedAt,
  loc: { type: "Point" as const, coordinates: [c.lng, c.lat] as [number, number] },
});

/**
 * Webcam persistence + admin reads. `upsertMany` dedups on the provider
 * `camId` (so catalog re-polls and manual re-adds refresh rather than
 * duplicate); `list` returns cams newest-first, optionally clipped by status
 * and a [w,s,e,n] bbox ("cams in this area").
 */
export function makeCamRepo(model: Model<iCamModel>) {
  return {
    model,

    /** Upsert a batch of cams on `camId`. Fills the GeoJSON `loc`. */
    async upsertMany(cams: Cam[]): Promise<{ upserted: number; matched: number }> {
      if (!cams.length) return { upserted: 0, matched: 0 };
      const fetchedAt = new Date();
      const ops = cams.map((c) => ({
        updateOne: {
          filter: { camId: c.camId },
          update: { $set: setDoc(c, fetchedAt), $setOnInsert: { id: uuidv4() } },
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Upsert a single cam and return its canonical wire shape. */
    async upsertOne(cam: Cam): Promise<Cam> {
      await this.upsertMany([cam]);
      const doc = await model.findOne({ camId: cam.camId }).lean().exec();
      return doc ? toCam(strip(doc)) : cam;
    },

    /** Cams (newest first), optionally filtered by status / bbox / text. */
    async list(opts: {
      status?: Cam["status"];
      bbox?: [number, number, number, number];
      q?: string;
      limit?: number;
    } = {}): Promise<Cam[]> {
      const query: Record<string, unknown> = {};
      if (opts.status) query.status = opts.status;
      if (opts.q) {
        const rx = new RegExp(opts.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        query.$or = [{ title: rx }, { place: rx }, { country: rx }];
      }
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        query.loc = {
          $geoWithin: { $geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        };
      }
      const docs = await model
        .find(query)
        .sort({ fetchedAt: -1 })
        .limit(opts.limit ?? 0)
        .lean()
        .exec();
      return docs.map((d) => toCam(strip(d)));
    },

    /** A single cam by provider id, or null. */
    async getByCamId(camId: string): Promise<Cam | null> {
      const doc = await model.findOne({ camId }).lean().exec();
      return doc ? toCam(strip(doc)) : null;
    },

    /** Patch status (admin toggle); returns the updated cam or null. */
    async setStatus(camId: string, status: Cam["status"]): Promise<Cam | null> {
      const doc = await model
        .findOneAndUpdate({ camId }, { $set: { status } }, { new: true })
        .lean()
        .exec();
      return doc ? toCam(strip(doc)) : null;
    },

    /** Delete a cam by provider id. Returns true if one was removed. */
    async remove(camId: string): Promise<boolean> {
      const res = await model.deleteOne({ camId }).exec();
      return (res.deletedCount ?? 0) > 0;
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type CamRepo = ReturnType<typeof makeCamRepo>;

import type { Model } from "mongoose";
import type { GeomagBounds, GeomagMeta } from "../geomag/types";
import type { iGeomagModel } from "./geomag-model";
import type { InlineBlobStore } from "./inline-blob";

const LATEST = "latest";

export interface GeomagBakeInput {
  epoch: number;
  year: number;
  nmax: number;
  bounds: GeomagBounds;
  width: number;
  height: number;
  minF: number;
  maxF: number;
  png: Buffer;
  contentType?: string;
}

const toMeta = (doc: any): GeomagMeta => ({
  epoch: doc.epoch,
  year: doc.year,
  nmax: doc.nmax ?? 1,
  bounds: doc.bounds as GeomagBounds,
  width: doc.width,
  height: doc.height,
  minF: doc.minF ?? 0,
  maxF: doc.maxF ?? 0,
  updatedAt: new Date(doc.fetchedAt).toISOString(),
});

/**
 * Geomagnetic-field-frame persistence + overlay reads. `replace` upserts the ONE
 * cached frame per bake. Reads split in two so the metadata endpoint never ships
 * the PNG bytes: `latest()` projects the blob out; `latestPng()` fetches only it.
 */
export function makeGeomagRepo(geomagModel: Model<iGeomagModel>, blobs: InlineBlobStore) {
  return {
    geomagModel,

    async replace(frame: GeomagBakeInput): Promise<{ minF: number; maxF: number }> {
      await blobs.put(LATEST, frame.png); // bytes to disk first when FS-backed
      await geomagModel.updateOne(
        { frameId: LATEST },
        {
          $set: {
            epoch: frame.epoch,
            year: frame.year,
            nmax: frame.nmax,
            bounds: frame.bounds,
            width: frame.width,
            height: frame.height,
            minF: frame.minF,
            maxF: frame.maxF,
            png: blobs.inlineValue(frame.png),
            contentType: frame.contentType ?? "image/png",
            fetchedAt: new Date(),
          },
          $setOnInsert: { id: LATEST, frameId: LATEST },
        },
        { upsert: true },
      );
      return { minF: frame.minF, maxF: frame.maxF };
    },

    async latest(): Promise<{ geomag: GeomagMeta | null }> {
      const doc = await geomagModel.findOne({ frameId: LATEST }).select("-png").lean().exec();
      return { geomag: doc ? toMeta(doc) : null };
    },

    async latestPng(): Promise<{ data: Buffer; contentType: string; updatedAt: string } | null> {
      const doc = await geomagModel.findOne({ frameId: LATEST }).exec();
      if (!doc) return null;
      const data = await blobs.get(LATEST, doc.png);
      if (!data || !data.length) return null;
      return {
        data,
        contentType: doc.contentType ?? "image/png",
        updatedAt: new Date(doc.fetchedAt).toISOString(),
      };
    },

    async count(): Promise<{ geomag: number }> {
      const geomag = await geomagModel.estimatedDocumentCount();
      return { geomag };
    },
  };
}

export type GeomagRepo = ReturnType<typeof makeGeomagRepo>;

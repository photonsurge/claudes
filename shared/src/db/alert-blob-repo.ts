import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AlertGeometry, SeverityRank } from "./alert-model";
import type { iAlertBlobModel, iBlobCity } from "./alert-blob-model";

export interface AlertBlobInput {
  hazard: string;
  severityRank: SeverityRank;
  geometry: AlertGeometry;
  memberIds: string[];
  /** Cities inside the shape, resolved once at rebuild — biggest first. */
  cities?: iBlobCity[];
}

/**
 * The dissolved-shape cache. Derived data with no stable identity — a blob IS its
 * geometry, and that changes as member alerts appear and expire — so a rebuild
 * REPLACES the set wholesale rather than trying to upsert shapes in place.
 */
export function makeAlertBlobRepo(model: Model<iAlertBlobModel>) {
  return {
    model,

    /** Swap in a freshly dissolved set. */
    async replace(blobs: AlertBlobInput[]): Promise<{ blobs: number }> {
      const builtAt = new Date();
      // Insert first, then drop the previous generation, so a reader polling
      // mid-rebuild sees the old shapes rather than an empty globe.
      const inserted = blobs.length
        ? await model.insertMany(
            blobs.map((b) => ({ ...b, id: uuidv4(), builtAt })),
            { ordered: false },
          )
        : [];
      await model.deleteMany({ builtAt: { $lt: builtAt } });
      return { blobs: inserted.length };
    },

    /** Every blob, worst hazard first — the overlay's read. */
    async list(): Promise<{ blobs: iAlertBlobModel[] }> {
      const docs = await model.find({}).sort({ severityRank: -1 }).lean().exec();
      return { blobs: docs as unknown as iAlertBlobModel[] };
    },

    async count(): Promise<{ blobs: number }> {
      return { blobs: await model.estimatedDocumentCount() };
    },
  };
}

export type AlertBlobRepo = ReturnType<typeof makeAlertBlobRepo>;

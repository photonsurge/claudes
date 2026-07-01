import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { Fault } from "../faults/types";
import type { iFaultModel } from "./fault-model";

const stripFault = (doc: any): Fault => ({
  id: doc.faultId,
  name: doc.name,
  type: doc.type,
  paths: doc.paths,
});

/**
 * Plate-boundary persistence + overlay reads. The worker `replace`s the whole
 * dataset on each slow snapshot (boundaries are an authoritative set, not an
 * accreting feed); `list` returns everything for the cached overlay. Upserts on
 * the deterministic source slug so a re-snapshot refreshes geometry without
 * dupes, then prunes any slugs that vanished from the source.
 */
export function makeFaultRepo(faultModel: Model<iFaultModel>) {
  return {
    faultModel,

    /** Replace the cached plate-boundary set with a fresh snapshot. */
    async replace(faults: Fault[]): Promise<{ faults: number }> {
      const fetchedAt = new Date();

      if (faults.length) {
        await faultModel.bulkWrite(
          faults.map((f) => ({
            updateOne: {
              filter: { faultId: f.id },
              update: {
                $set: { name: f.name, type: f.type, paths: f.paths, fetchedAt },
                $setOnInsert: { id: uuidv4() },
              },
              upsert: true,
            },
          })),
        );
        await faultModel.deleteMany({ faultId: { $nin: faults.map((f) => f.id) } });
      }

      return { faults: faults.length };
    },

    /** The full cached dataset for the overlay. */
    async list(): Promise<{ faults: Fault[] }> {
      const docs = await faultModel.find({}).lean().exec();
      return { faults: docs.map(stripFault) };
    },

    async count(): Promise<{ faults: number }> {
      const faults = await faultModel.estimatedDocumentCount();
      return { faults };
    },
  };
}

export type FaultRepo = ReturnType<typeof makeFaultRepo>;

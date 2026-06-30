import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { Cable, LandingPoint } from "../cables/types";
import type { iCableModel } from "./cable-model";
import type { iCableLandingModel } from "./cable-landing-model";

const stripCable = (doc: any): Cable => ({
  id: doc.cableId,
  name: doc.name,
  color: doc.color,
  paths: doc.paths,
});

const stripLanding = (doc: any): LandingPoint => ({
  id: doc.landingId,
  name: doc.name,
  lng: doc.lng,
  lat: doc.lat,
});

/**
 * Submarine-cable persistence + overlay reads. The worker `replace`s the whole
 * dataset on each slow snapshot (cables/landings are an authoritative set, not
 * an accreting feed); `list` returns everything for the cached overlay. Both
 * upsert on the source slug so a re-snapshot refreshes geometry without dupes,
 * then prune any slugs that vanished from the source.
 */
export function makeCableRepo(
  cableModel: Model<iCableModel>,
  landingModel: Model<iCableLandingModel>,
) {
  return {
    cableModel,
    landingModel,

    /** Replace the cached cable + landing sets with a fresh snapshot. */
    async replace(
      cables: Cable[],
      landings: LandingPoint[],
    ): Promise<{ cables: number; landings: number }> {
      const fetchedAt = new Date();

      if (cables.length) {
        await cableModel.bulkWrite(
          cables.map((c) => ({
            updateOne: {
              filter: { cableId: c.id },
              update: {
                $set: { name: c.name, color: c.color, paths: c.paths, fetchedAt },
                $setOnInsert: { id: uuidv4() },
              },
              upsert: true,
            },
          })),
        );
        await cableModel.deleteMany({ cableId: { $nin: cables.map((c) => c.id) } });
      }

      if (landings.length) {
        await landingModel.bulkWrite(
          landings.map((l) => ({
            updateOne: {
              filter: { landingId: l.id },
              update: {
                $set: { name: l.name, lng: l.lng, lat: l.lat, fetchedAt },
                $setOnInsert: { id: uuidv4() },
              },
              upsert: true,
            },
          })),
        );
        await landingModel.deleteMany({ landingId: { $nin: landings.map((l) => l.id) } });
      }

      return { cables: cables.length, landings: landings.length };
    },

    /** The full cached dataset for the overlay. */
    async list(): Promise<{ cables: Cable[]; landings: LandingPoint[] }> {
      const [cableDocs, landingDocs] = await Promise.all([
        cableModel.find({}).lean().exec(),
        landingModel.find({}).lean().exec(),
      ]);
      return {
        cables: cableDocs.map(stripCable),
        landings: landingDocs.map(stripLanding),
      };
    },

    async count(): Promise<{ cables: number; landings: number }> {
      const [cables, landings] = await Promise.all([
        cableModel.estimatedDocumentCount(),
        landingModel.estimatedDocumentCount(),
      ]);
      return { cables, landings };
    },
  };
}

export type CableRepo = ReturnType<typeof makeCableRepo>;

import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AlertGeometry } from "./alert-model";
import type { iAlertAreaGeomModel } from "./alert-area-geom-model";
import type { iAlertGeomSeenModel } from "./alert-geom-seen-model";

/** One resolved EMMA area, as the sync job hands it over. */
export interface AreaGeomInput {
  emmaId: string;
  countryCode?: string;
  areaDesc?: string;
  geometry: AlertGeometry;
  precision: "exact" | "bbox";
  source?: string;
}

/** What the ingest enrich needs to draw an area: its shape and how good it is. */
export interface CachedAreaGeom {
  geometry: AlertGeometry;
  precision: "exact" | "bbox";
}

/**
 * The EMMA_ID → boundary cache plus the "already resolved" ledger that keeps the
 * sync cheap. Two collections, one repo: they're written together on every sync
 * tick and neither is meaningful alone (cable-repo does the same for its two).
 *
 * Reads are the hot path — the alerts ingest looks up every area's EMMA_ID on
 * each tick — so `byEmmaIds` is a single batched query, never a loop.
 */
export function makeAlertAreaGeomRepo(
  geomModel: Model<iAlertAreaGeomModel>,
  seenModel: Model<iAlertGeomSeenModel>,
) {
  return {
    geomModel,
    seenModel,

    /**
     * Cache resolved boundaries. Upserts on `emmaId` so a re-resolve refreshes
     * in place; an `exact` shape overwrites a `bbox` row, but a `bbox` never
     * clobbers an `exact` one we already earned.
     */
    async upsertAreas(areas: AreaGeomInput[]): Promise<{ upserted: number }> {
      if (!areas.length) return { upserted: 0 };
      const fetchedAt = new Date();
      await geomModel.bulkWrite(
        areas.map((a) => ({
          updateOne: {
            filter:
              a.precision === "exact"
                ? { emmaId: a.emmaId }
                : { emmaId: a.emmaId, precision: { $ne: "exact" } },
            update: {
              $set: {
                countryCode: a.countryCode,
                areaDesc: a.areaDesc,
                geometry: a.geometry,
                precision: a.precision,
                source: a.source ?? "meteogate",
                fetchedAt,
              },
              $setOnInsert: { id: uuidv4(), emmaId: a.emmaId },
            },
            upsert: true,
          },
        })),
        // An upsert racing another worker on the same EMMA_ID is a duplicate-key,
        // not a failure — the row we wanted exists. Keep going.
        { ordered: false },
      );
      return { upserted: areas.length };
    },

    /** Batched EMMA_ID → geometry lookup for the ingest enrich. */
    async byEmmaIds(emmaIds: string[]): Promise<Map<string, CachedAreaGeom>> {
      const ids = [...new Set(emmaIds.filter(Boolean))];
      if (!ids.length) return new Map();
      const docs = await geomModel
        .find({ emmaId: { $in: ids } }, { emmaId: 1, geometry: 1, precision: 1 })
        .lean()
        .exec();
      return new Map(
        docs.map((d: any) => [d.emmaId, { geometry: d.geometry, precision: d.precision }]),
      );
    },

    /** EMMA_IDs already cached — lets the sync skip resolving a known area. */
    async knownEmmaIds(): Promise<Set<string>> {
      const docs = await geomModel.find({}, { emmaId: 1 }).lean().exec();
      return new Set(docs.map((d: any) => d.emmaId));
    },

    /** Which of `alertIds` we've resolved before (and can skip re-fetching). */
    async seenAlertIds(alertIds: string[]): Promise<Set<string>> {
      const ids = [...new Set(alertIds.filter(Boolean))];
      if (!ids.length) return new Set();
      const docs = await seenModel
        .find({ alertId: { $in: ids } }, { alertId: 1 })
        .lean()
        .exec();
      return new Set(docs.map((d: any) => d.alertId));
    },

    /** Remember alertIds we resolved this run, so the next run skips them. */
    async markSeen(rows: { alertId: string; emmaId?: string }[]): Promise<void> {
      if (!rows.length) return;
      const seenAt = new Date();
      await seenModel.bulkWrite(
        rows.map((r) => ({
          updateOne: {
            filter: { alertId: r.alertId },
            update: { $set: { emmaId: r.emmaId, seenAt }, $setOnInsert: { id: uuidv4() } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    },

    async count(): Promise<{ areas: number; exact: number; seen: number }> {
      const [areas, exact, seen] = await Promise.all([
        geomModel.estimatedDocumentCount(),
        geomModel.countDocuments({ precision: "exact" }),
        seenModel.estimatedDocumentCount(),
      ]);
      return { areas, exact, seen };
    },
  };
}

export type AlertAreaGeomRepo = ReturnType<typeof makeAlertAreaGeomRepo>;

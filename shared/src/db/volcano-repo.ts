import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { Volcano, VolcanoStatus } from "../volcanoes/types";
import type { iVolcanoModel } from "./volcano-model";

const strip = (doc: any): Volcano => ({
  id: doc.volcanoId,
  name: doc.name,
  country: doc.country || undefined,
  lat: doc.lat,
  lng: doc.lng,
  status: doc.status as VolcanoStatus,
  firstDate: new Date(doc.firstDate).getTime(),
  lastDate: new Date(doc.lastDate).getTime(),
  statusChangedAt: new Date(doc.statusChangedAt).getTime(),
  sourceUrl: doc.sourceUrl || undefined,
  latestReport: doc.latestReport || undefined,
  reportDateRange: doc.reportDateRange || undefined,
  wikiTitle: doc.wikiTitle || undefined,
  wikiThumb: doc.wikiThumb || undefined,
  wikiExtract: doc.wikiExtract || undefined,
  wikiFetchedAt: doc.wikiFetchedAt ? new Date(doc.wikiFetchedAt).getTime() : undefined,
});

/**
 * Active-volcano persistence + overlay reads. `upsertMany` dedups on the source
 * `volcanoId` (a re-poll while still active refreshes `fetchedAt`, extending its
 * TTL); `list` returns everything by default — no cap.
 */
export function makeVolcanoRepo(model: Model<iVolcanoModel>) {
  return {
    model,

    /**
     * Upsert a batch of volcanoes on `volcanoId`. Fills the GeoJSON `loc`. Uses
     * an aggregation-pipeline update (not a plain `$set`/`$setOnInsert`) so two
     * fields can depend on the PREVIOUS stored value, which a plain update
     * can't express:
     *  - `firstDate` only set on the FIRST insert (`$ifNull` against the
     *    existing value) — tracks "since when has our cache been tracking this
     *    volcano" rather than the source's own event-start concept (the weekly
     *    bulletin doesn't have one), so it must not be overwritten on re-poll.
     *  - `statusChangedAt` only advances when `status` actually differs from
     *    what's already stored (or the doc is new) — the source republishes
     *    weekly regardless of whether anything changed, so a plain `$set`
     *    would make every volcano look like it "just changed" on every poll.
     */
    async upsertMany(volcanoes: Volcano[]): Promise<{ upserted: number; matched: number }> {
      if (!volcanoes.length) return { upserted: 0, matched: 0 };
      const fetchedAt = new Date();
      const ops = volcanoes.map((v) => ({
        updateOne: {
          filter: { volcanoId: v.id },
          update: [
            {
              $set: {
                id: { $ifNull: ["$id", uuidv4()] },
                name: v.name,
                country: v.country,
                lat: v.lat,
                lng: v.lng,
                status: v.status,
                firstDate: { $ifNull: ["$firstDate", new Date(v.firstDate)] },
                lastDate: new Date(v.lastDate),
                statusChangedAt: {
                  $cond: [{ $eq: ["$status", v.status] }, { $ifNull: ["$statusChangedAt", fetchedAt] }, fetchedAt],
                },
                sourceUrl: v.sourceUrl,
                latestReport: v.latestReport,
                reportDateRange: v.reportDateRange,
                fetchedAt,
                loc: { type: "Point" as const, coordinates: [v.lng, v.lat] as [number, number] },
              },
            },
          ],
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Active volcanoes (most recently updated first), optionally filtered by status/bbox. */
    async list(opts: {
      status?: VolcanoStatus;
      bbox?: [number, number, number, number];
      limit?: number;
    } = {}): Promise<Volcano[]> {
      const q: Record<string, unknown> = {};
      if (opts.status) q.status = opts.status;
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q.loc = {
          $geoWithin: { $geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        };
      }
      // limit(0) = no cap: show every active volcano by default.
      const docs = await model.find(q).sort({ lastDate: -1 }).limit(opts.limit ?? 0).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },

    /** Volcanoes whose Wikipedia enrichment is missing or older than `staleBefore` (unless `force`). */
    async listNeedingEnrichment(staleBefore: Date, force = false): Promise<iVolcanoModel[]> {
      const q = force ? {} : { wikiFetchedAt: { $not: { $gt: staleBefore } } };
      return model.find(q).lean().exec();
    },

    /** Patch Wikipedia enrichment fields onto one volcano by its source `volcanoId`. */
    async updateEnrichment(
      volcanoId: string,
      patch: { wikiTitle?: string; wikiThumb?: string; wikiExtract?: string; wikiFetchedAt: Date },
    ): Promise<void> {
      await model.updateOne({ volcanoId }, { $set: patch }).exec();
    },
  };
}

export type VolcanoRepo = ReturnType<typeof makeVolcanoRepo>;

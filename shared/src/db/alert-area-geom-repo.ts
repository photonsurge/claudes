import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AlertGeometry } from "./alert-model";
import type { iAlertAreaGeomModel } from "./alert-area-geom-model";
import type { iAlertGeomSeenModel } from "./alert-geom-seen-model";
import type { iAlertGeomCrawlModel } from "./alert-geom-crawl-model";

/** One country's resumable deep-crawl position. See {@link iAlertGeomCrawl}. */
export interface CrawlCursor {
  countryCode: string;
  windowFrom: Date;
  windowTo: Date;
  nextPage: number;
  totalPages: number;
  completedAt?: Date;
}

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
 *
 * Three collections now: the crawl cursors joined them for the same reason, being
 * written on the same tick by the same job and meaningless on their own.
 */
export function makeAlertAreaGeomRepo(
  geomModel: Model<iAlertAreaGeomModel>,
  seenModel: Model<iAlertGeomSeenModel>,
  crawlModel: Model<iAlertGeomCrawlModel>,
) {
  return {
    geomModel,
    seenModel,
    crawlModel,

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

    /**
     * Cached boundaries nobody has checked are storable yet, oldest first.
     *
     * The backlog from before geometry was repaired on the way in. Bounded, and
     * the marker makes it terminate: once swept, this returns nothing forever.
     * Costs no MeteoGate quota — the shapes are already here, they just need
     * fixing, not re-fetching.
     */
    async uncheckedAreas(limit: number): Promise<{ emmaId: string; geometry: AlertGeometry }[]> {
      if (limit <= 0) return [];
      const docs = await geomModel
        .find({ checkedAt: { $exists: false } }, { _id: 0, emmaId: 1, geometry: 1 })
        .limit(Math.floor(limit))
        .lean()
        .exec();
      return docs as unknown as { emmaId: string; geometry: AlertGeometry }[];
    },

    /**
     * Record that a boundary was checked, replacing its geometry when it needed
     * repairing. Marked either way, so a shape is never re-examined.
     */
    async markChecked(emmaId: string, geometry?: AlertGeometry | null): Promise<void> {
      await geomModel
        .updateOne(
          { emmaId },
          { $set: geometry ? { geometry, checkedAt: new Date() } : { checkedAt: new Date() } },
        )
        .exec();
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

    /**
     * Every country's crawl cursor, by country code. One query — the sweep needs
     * all of them to plan a round-robin, and 39 point reads would be silly.
     */
    async crawlCursors(): Promise<Map<string, CrawlCursor>> {
      const docs = await crawlModel.find({}, { _id: 0, __v: 0 }).lean().exec();
      return new Map((docs as unknown as CrawlCursor[]).map((d) => [d.countryCode, d]));
    },

    /**
     * Open a crawl over a frozen window, discarding any previous one for that
     * country. Called when there's no cursor, when the old crawl finished long
     * enough ago to be worth redoing, or when `totalPages` moved under a crawl
     * (which means the window is no longer being honoured and the page numbers
     * are meaningless — start again rather than walk a shifting list).
     */
    async startCrawl(c: {
      countryCode: string;
      windowFrom: Date;
      windowTo: Date;
      totalPages: number;
    }): Promise<void> {
      const now = new Date();
      await crawlModel
        .updateOne(
          { countryCode: c.countryCode },
          {
            $set: {
              windowFrom: c.windowFrom,
              windowTo: c.windowTo,
              totalPages: c.totalPages,
              nextPage: 2, // page 1 is read every run for freshness
              startedAt: now,
              updatedAt: now,
            },
            $unset: { completedAt: "" },
            $setOnInsert: { id: uuidv4() },
          },
          { upsert: true },
        )
        .exec();
    },

    /**
     * Record how far the crawl got. `nextPage` only ever moves forward, so a run
     * that dies mid-country resumes rather than restarts; passing `totalPages`
     * closes the crawl and the middle is skipped until it's due again.
     */
    async advanceCrawl(countryCode: string, nextPage: number, done: boolean): Promise<void> {
      await crawlModel
        .updateOne(
          { countryCode },
          {
            $max: { nextPage },
            $set: { updatedAt: new Date(), ...(done ? { completedAt: new Date() } : {}) },
          },
        )
        .exec();
    },

    async count(): Promise<{ areas: number; exact: number; seen: number; crawlsDone: number }> {
      const [areas, exact, seen, crawlsDone] = await Promise.all([
        geomModel.estimatedDocumentCount(),
        geomModel.countDocuments({ precision: "exact" }),
        seenModel.estimatedDocumentCount(),
        crawlModel.countDocuments({ completedAt: { $exists: true } }),
      ]);
      return { areas, exact, seen, crawlsDone };
    },
  };
}

export type AlertAreaGeomRepo = ReturnType<typeof makeAlertAreaGeomRepo>;

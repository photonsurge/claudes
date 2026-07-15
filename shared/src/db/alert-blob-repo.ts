import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AlertGeometry, SeverityRank } from "./alert-model";
import type { iAlertBlobModel, iBlobCity } from "./alert-blob-model";

export interface AlertBlobInput {
  hazard: string;
  severityRank: SeverityRank;
  geometry: AlertGeometry;
  bbox: [number, number, number, number];
  memberIds: string[];
  /** Cities inside the shape, resolved once at rebuild — biggest first. */
  cities?: iBlobCity[];
}

/**
 * A blob as the panels want it: what the hazard is and who's under it, with the
 * polygon left in the database.
 *
 * The geometry is the whole weight of a blob — a single dissolved shape runs to
 * thousands of vertices — and no panel draws it (the globe has its own overlay
 * feed). Reading it just to drop it is how the alerts read became a hard OOM, so
 * this shape exists to make omitting it the easy path.
 */
export interface AlertBlobSummary {
  id: string;
  hazard: string;
  severityRank: SeverityRank;
  bbox: [number, number, number, number];
  /** How many alerts fused into the shape. */
  alertCount: number;
  /** How many cities the WHOLE shape covers, however many are returned below. */
  cityCount: number;
  cities: iBlobCity[];
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
      const n = await this.addGeneration(blobs, builtAt);
      await this.dropOlderThan(builtAt);
      return { blobs: n };
    },

    /**
     * Write one instalment of a rebuild, tagged with the generation it belongs to.
     *
     * The rebuild streams: holding every dissolved shape until the end meant
     * ~1.9M vertices of finished output sitting in the heap ON TOP of whatever
     * hazard was mid-clip, and this worker shares a 4GB heap with ten other jobs
     * — it OOM'd. Writing each hazard's shapes as they're finished keeps the
     * job's footprint to the bucket it's actually working on.
     */
    async addGeneration(blobs: AlertBlobInput[], builtAt: Date): Promise<number> {
      if (!blobs.length) return 0;
      const docs = await model.insertMany(
        blobs.map((b) => ({ ...b, id: uuidv4(), builtAt })),
        { ordered: false },
      );
      return docs.length;
    },

    /**
     * Retire every shape older than this rebuild. Called LAST, so a reader polling
     * mid-rebuild always sees a complete previous generation rather than a globe
     * that's half-empty while the new one lands.
     */
    async dropOlderThan(builtAt: Date): Promise<{ removed: number }> {
      const r = await model.deleteMany({ builtAt: { $lt: builtAt } });
      return { removed: r.deletedCount ?? 0 };
    },

    /** Every blob, worst hazard first — the overlay's read. */
    async list(): Promise<{ blobs: iAlertBlobModel[] }> {
      const docs = await model.find({}).sort({ severityRank: -1 }).lean().exec();
      return { blobs: docs as unknown as iAlertBlobModel[] };
    },

    /**
     * The blobs overlapping a camera view, worst hazard first, geometry left behind.
     *
     * The bbox test runs in MONGO rather than here on purpose. Pulling all the
     * blobs back and filtering in JS would drag every shape's city list into the
     * heap to throw most of it away — the same read-everything-to-drop-it move
     * that made the alerts read an OOM.
     *
     * `cities` comes back scoped to the same view, because that's what a caption
     * over this shot can actually name; `cityCount` keeps the honest total for
     * the whole shape, so "and 1,140 more" stays true.
     */
    async summariesForBbox(
      bbox: [number, number, number, number],
    ): Promise<AlertBlobSummary[]> {
      const [w, s, e, n] = bbox;
      // A camera bbox may wrap the antimeridian (w > e); a blob's never does —
      // `bounds()` takes raw min/max, so a Pacific-spanning shape reports as very
      // wide rather than wrapping. So only the view needs splitting in two.
      const spans: [number, number][] = w <= e ? [[w, e]] : [[w, 180], [-180, e]];
      const el = (i: number) => ({ $arrayElemAt: ["$bbox", i] });
      const overlapsLng = spans.map(([a, b]) => ({
        $expr: { $and: [{ $lte: [el(0), b] }, { $gte: [el(2), a] }] },
      }));

      const docs = await model
        .find(
          {
            $and: [
              { $or: overlapsLng },
              { $expr: { $and: [{ $lte: [el(1), n] }, { $gte: [el(3), s] }] } },
            ],
          },
          { _id: 0, id: 1, hazard: 1, severityRank: 1, bbox: 1, memberIds: 1, cities: 1 },
        )
        .sort({ severityRank: -1 })
        .lean()
        .exec();

      const inView = (c: iBlobCity) =>
        c.lat >= s && c.lat <= n && spans.some(([a, b]) => c.lng >= a && c.lng <= b);

      return (docs as unknown as iAlertBlobModel[]).map((d) => ({
        id: d.id,
        hazard: d.hazard,
        severityRank: d.severityRank,
        bbox: d.bbox,
        alertCount: d.memberIds?.length ?? 0,
        cityCount: d.cities?.length ?? 0,
        cities: (d.cities ?? []).filter(inView),
      }));
    },

    async count(): Promise<{ blobs: number }> {
      return { blobs: await model.estimatedDocumentCount() };
    },
  };
}

export type AlertBlobRepo = ReturnType<typeof makeAlertBlobRepo>;

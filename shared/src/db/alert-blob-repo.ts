import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AlertGeometry, SeverityRank } from "./alert-model";
import type { iAlertBlobModel, iBlobCity } from "./alert-blob-model";

export interface AlertBlobInput {
  hazard: string;
  severityRank: SeverityRank;
  /** ISO-3166 alpha-2 the members share; a blob never crosses a border. */
  country?: string;
  geometry: AlertGeometry;
  bbox: [number, number, number, number];
  memberIds: string[];
  /** Dissolve bucket + member fingerprint — see the model; lets rebuilds skip clean buckets. */
  bucketKey?: string;
  fingerprint?: string;
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
  /** Whose warning this is — every member shares it (part of the bucket key). */
  country?: string;
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
      await this.commitGeneration(builtAt);
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
        // `live: false` — invisible until the whole generation has landed. See
        // `commitGeneration`; this is what stops a half-written rebuild reaching
        // the globe, and what stops a DEAD one doubling it.
        blobs.map((b) => ({ ...b, id: uuidv4(), builtAt, live: false })),
        { ordered: false },
      );
      return docs.length;
    },

    /**
     * Put a finished generation on air and retire every older one. The commit.
     *
     * Two steps, in this order, and the order is the whole point: flip the new
     * generation live, THEN drop the old. Readers filter on `live`, so the swap
     * is atomic from where they stand — they see the previous generation whole
     * right up until they see the new one whole, and never a mixture.
     *
     * Nothing calls this until every instalment has landed, which is what makes a
     * dead rebuild harmless. Before `live` existed, the old generation was retired
     * at the end of the job and a job that died before that line left BOTH sets in
     * the collection forever: the globe drew every shape twice, stacked, and it
     * read as pairs of identical overlapping warnings.
     */
    async commitGeneration(builtAt: Date): Promise<{ live: number; removed: number }> {
      const up = await model.updateMany({ builtAt }, { $set: { live: true } });
      // `$lt`, never `$lte` — the generation we just put on air carries this exact
      // builtAt, and `$lte` would delete it.
      const del = await model.deleteMany({ builtAt: { $lt: builtAt } });
      return { live: up.modifiedCount ?? 0, removed: del.deletedCount ?? 0 };
    },

    /**
     * What's on air right now, as bucket → fingerprint — the rebuild's "what can
     * I skip" question, answered without touching a single polygon.
     *
     * A bucket's shapes all share one fingerprint by construction; if the data
     * ever disagrees with that (two generations tangled), the bucket maps to
     * undefined so it can never match and gets honestly re-dissolved.
     */
    async liveIndex(): Promise<Map<string, string | undefined>> {
      const docs = (await model
        .find({ live: true }, { _id: 0, bucketKey: 1, fingerprint: 1 })
        .lean()
        .exec()) as unknown as Array<{ bucketKey?: string; fingerprint?: string }>;
      const out = new Map<string, string | undefined>();
      for (const d of docs) {
        if (!d.bucketKey) continue; // pre-fingerprint generation — nothing to match
        if (out.has(d.bucketKey) && out.get(d.bucketKey) !== d.fingerprint) {
          out.set(d.bucketKey, undefined);
        } else if (!out.has(d.bucketKey)) {
          out.set(d.bucketKey, d.fingerprint);
        }
      }
      return out;
    },

    /**
     * Adopt a clean bucket's live shapes into the generation being built — the
     * skip that makes the rebuild incremental. Just a builtAt bump: the shapes
     * stay live (their geometry is unchanged, readers should keep seeing them)
     * and the new stamp is what stops `commitGeneration`'s sweep deleting them
     * with the rest of the old generation.
     */
    async carryForward(bucketKey: string, builtAt: Date): Promise<number> {
      const r = await model.updateMany({ live: true, bucketKey }, { $set: { builtAt } });
      return r.modifiedCount ?? 0;
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

    /** Every LIVE blob, worst hazard first — the overlay's read. */
    async list(): Promise<{ blobs: iAlertBlobModel[] }> {
      // `live` is not optional: without it this returns every generation in the
      // collection at once and the globe draws each shape once per generation.
      const docs = await model.find({ live: true }).sort({ severityRank: -1 }).lean().exec();
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
            // Same rule as `list()`: only the generation that's on air. Without
            // it a rebuild's worth of stale shapes lands in the focus bundle and
            // every warning gets counted once per generation.
            live: true,
            $and: [
              { $or: overlapsLng },
              { $expr: { $and: [{ $lte: [el(1), n] }, { $gte: [el(3), s] }] } },
            ],
          },
          { _id: 0, id: 1, hazard: 1, severityRank: 1, country: 1, bbox: 1, memberIds: 1, cities: 1 },
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
        country: d.country,
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

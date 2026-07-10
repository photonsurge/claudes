import type { Model, PipelineStage } from "mongoose";
import type { iTrackSnapshot, iTrackSnapshotModel, TrackSnapshotKind } from "./track-snapshot-model";

const strip = (doc: any): iTrackSnapshotModel => {
  const { __v, _id, ...rest } = doc;
  return rest as iTrackSnapshotModel;
};

/**
 * Snapshot history persistence + replay reads. `record` writes one frame's worth
 * of positions; `batches` lists frame timestamps in a window (the scrubber);
 * `atBatch` returns the positions of a single frame.
 */
export function makeTrackSnapshotRepo(model: Model<iTrackSnapshotModel>) {
  return {
    model,

    /** Insert one batch (frame) of snapshots. Fills the GeoJSON `loc` from lng/lat. */
    async record(snaps: iTrackSnapshot[]): Promise<number> {
      if (!snaps.length) return 0;
      const docs = snaps.map((s) => ({
        ...s,
        loc: { type: "Point" as const, coordinates: [s.lng, s.lat] as [number, number] },
      }));
      const res = await model.insertMany(docs, { ordered: false });
      return res.length;
    },

    /** Distinct frame timestamps (newest first) within [from, to]. */
    async batches(opts: { from?: Date; to?: Date; kind?: TrackSnapshotKind; limit?: number } = {}): Promise<string[]> {
      const q: Record<string, unknown> = {};
      if (opts.kind) q.kind = opts.kind;
      if (opts.from || opts.to) {
        q.batchAt = {
          ...(opts.from ? { $gte: opts.from } : {}),
          ...(opts.to ? { $lte: opts.to } : {}),
        };
      }
      const times: Date[] = await model.distinct("batchAt", q);
      return times
        .map((d) => new Date(d).toISOString())
        .sort()
        .reverse()
        .slice(0, opts.limit ?? 500);
    },

    /** All snapshots in one frame, optionally filtered by kind/bbox. */
    async atBatch(
      batchAt: Date,
      opts: { kind?: TrackSnapshotKind; bbox?: [number, number, number, number]; limit?: number } = {},
    ): Promise<iTrackSnapshotModel[]> {
      const q: Record<string, unknown> = { batchAt };
      if (opts.kind) q.kind = opts.kind;
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q.loc = {
          $geoWithin: { $geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        };
      }
      const docs = await model.find(q).limit(opts.limit ?? 5000).lean().exec();
      return docs.map(strip);
    },

    /**
     * The most-recent frame for a kind (the live cache the public routes read),
     * with its `batchAt` so the client can dead-reckon positions forward from it.
     * Optionally clipped to a bbox.
     */
    async latest(opts: {
      kind: TrackSnapshotKind;
      bbox?: [number, number, number, number];
      ids?: string[];
      limit?: number;
    }): Promise<{ at: Date | null; rows: iTrackSnapshotModel[] }> {
      const newest = await model
        .findOne({ kind: opts.kind })
        .sort({ batchAt: -1 })
        .select("batchAt")
        .lean()
        .exec();
      if (!newest) return { at: null, rows: [] };
      const at = new Date((newest as { batchAt: Date }).batchAt);

      const q: Record<string, unknown> = { kind: opts.kind, batchAt: at };
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q.loc = {
          $geoWithin: { $geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        };
      }
      // Scope to an explicit id set (the overlay sends the notable + on-air craft
      // when zoomed out, so the world view loads a handful instead of the whole
      // planet). Case-insensitive — snapshot externalIds keep the provider's
      // casing while the registry lowercases its codes; the {kind,batchAt} match
      // above already narrows to one frame, so the $expr only scans that frame.
      if (opts.ids && opts.ids.length) {
        const idset = opts.ids.map((s) => s.toLowerCase());
        q.$expr = { $in: [{ $toLower: "$externalId" }, idset] };
      }
      // limit 0 = no cap (Mongo) — return the whole frame for the live overlay.
      const docs = await model.find(q).limit(opts.limit ?? 0).lean().exec();
      return { at, rows: docs.map(strip) };
    },

    /**
     * Per-track trailing paths within [from, now]: one polyline per externalId,
     * positions ordered oldest→newest. Aggregated in Mongo so we ship one line
     * per track (not every raw frame) — the source for the live trails overlay.
     * Only tracks with ≥2 points are returned (a single point can't draw a line).
     *
     * Pass `ids` to scope the aggregation to a handful of tracks (the live
     * overlay sends the on-air + notable craft). Without it the whole window is
     * grouped — one trail per track worldwide, which is both illegible and the
     * slowest overlay to load, so the live path always scopes.
     */
    async paths(opts: {
      from: Date;
      kind?: TrackSnapshotKind;
      ids?: string[];
      maxTracks?: number;
    }): Promise<Array<{ externalId: string; kind: TrackSnapshotKind; name?: string; path: [number, number][] }>> {
      const match: Record<string, unknown> = { batchAt: { $gte: opts.from } };
      if (opts.kind) match.kind = opts.kind;
      const pipeline: PipelineStage[] = [{ $match: match }];
      // Scope to an explicit id set. Snapshot externalIds are stored raw (the
      // provider's casing) while the registry lowercases its codes, so match on
      // a lowered copy of both sides. The {kind,batchAt} window match runs first,
      // so this filters an already-small slice — no index on externalId needed.
      if (opts.ids && opts.ids.length) {
        const idset = opts.ids.map((s) => s.toLowerCase());
        pipeline.push({ $addFields: { _lid: { $toLower: "$externalId" } } } as PipelineStage);
        pipeline.push({ $match: { _lid: { $in: idset } } } as PipelineStage);
      }
      pipeline.push({ $sort: { batchAt: 1 } } as PipelineStage);
      pipeline.push({
        $group: {
          _id: "$externalId",
          kind: { $first: "$kind" },
          name: { $last: "$name" },
          // Push an object per point; $push won't take a 2-element array
          // literal (Mongo reads it as multiple operator args).
          pts: { $push: { lng: "$lng", lat: "$lat" } },
        },
      } as PipelineStage);
      pipeline.push({ $match: { "pts.1": { $exists: true } } } as PipelineStage);
      // No cap by default — every scoped track gets a trail. Only limit when the
      // caller explicitly asks (maxTracks > 0); 0/undefined = whole (scoped) set.
      if (opts.maxTracks && opts.maxTracks > 0) pipeline.push({ $limit: opts.maxTracks } as PipelineStage);
      const rows = await model.aggregate(pipeline).exec();
      return rows.map((r: any) => ({
        externalId: r._id as string,
        kind: r.kind as TrackSnapshotKind,
        name: (r.name as string) ?? undefined,
        path: (r.pts as { lng: number; lat: number }[]).map((p) => [p.lng, p.lat] as [number, number]),
      }));
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type TrackSnapshotRepo = ReturnType<typeof makeTrackSnapshotRepo>;

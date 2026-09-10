import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { AlertSnapshotKind, iAlertSnapshotModel } from "./alert-snapshot-model";
import type { InlineBlobStore } from "./inline-blob";

/** Snapshot metadata (never ships the pixel bytes). */
export interface AlertSnapshotMeta {
  id: string;
  source: string;
  identifier: string;
  alertId?: string;
  kind: AlertSnapshotKind;
  layer?: string;
  pairKey?: string;
  hourSlot: string;
  bounds?: number[];
  width: number;
  height: number;
  observationTime: string;
  capturedAt: string;
  pHash?: string;
  camId?: string;
  distanceKm?: number;
  attribution?: string;
}

/** Everything the worker hands the repo for one captured frame. */
export interface AlertSnapshotInput {
  source: string;
  identifier: string;
  alertId?: string;
  kind: AlertSnapshotKind;
  layer?: string;
  pairKey?: string;
  hourSlot: string;
  bounds?: number[];
  width: number;
  height: number;
  observationTime: Date;
  png: Buffer;
  contentType?: string;
  pHash?: string;
  camId?: string;
  distanceKm?: number;
  attribution?: string;
}

const toMeta = (doc: any): AlertSnapshotMeta => ({
  id: doc.id,
  source: doc.source,
  identifier: doc.identifier,
  alertId: doc.alertId,
  kind: doc.kind,
  layer: doc.layer,
  pairKey: doc.pairKey,
  hourSlot: doc.hourSlot,
  bounds: doc.bounds,
  width: doc.width,
  height: doc.height,
  observationTime: new Date(doc.observationTime).toISOString(),
  capturedAt: new Date(doc.capturedAt).toISOString(),
  pHash: doc.pHash,
  camId: doc.camId,
  distanceKm: doc.distanceKm,
  attribution: doc.attribution,
});

/**
 * Alert-snapshot persistence. Bytes go to the shared FS blob store keyed by the
 * doc id; the metadata doc is byte-free when FS-backed. One doc per `slotKey`
 * (per-hour dedup) — re-running the same hour replaces in place. Reads split so
 * metadata never ships pixels (`listForAlert` projects `-png`); `getPng` fetches
 * bytes for the media route.
 */
export function makeAlertSnapshotRepo(model: Model<iAlertSnapshotModel>, blobs: InlineBlobStore) {
  const slotKeyOf = (s: Pick<AlertSnapshotInput, "alertId" | "kind" | "layer" | "hourSlot">) =>
    `${s.alertId ?? "_"}:${s.kind}:${s.layer ?? ""}:${s.hourSlot}`;

  return {
    model,

    /** Store (or replace) one frame for its hour slot. Bytes to disk, metadata to Mongo. */
    async put(snap: AlertSnapshotInput): Promise<{ id: string }> {
      const slotKey = slotKeyOf(snap);
      const existing = await model.findOne({ slotKey }, { id: 1, _id: 0 }).lean<{ id: string }>().exec();
      const id = existing?.id ?? uuidv4();
      await blobs.put(id, snap.png); // bytes to disk first when FS-backed
      await model
        .updateOne(
          { slotKey },
          {
            $set: {
              source: snap.source,
              identifier: snap.identifier,
              alertId: snap.alertId,
              kind: snap.kind,
              layer: snap.layer,
              pairKey: snap.pairKey,
              hourSlot: snap.hourSlot,
              bounds: snap.bounds,
              width: snap.width,
              height: snap.height,
              observationTime: snap.observationTime,
              capturedAt: new Date(),
              contentType: snap.contentType ?? "image/png",
              pHash: snap.pHash,
              camId: snap.camId,
              distanceKm: snap.distanceKm,
              attribution: snap.attribution,
              png: blobs.inlineValue(snap.png),
            },
            $setOnInsert: { id },
          },
          { upsert: true },
        )
        .exec();
      return { id };
    },

    /** All snapshot metadata for one alert, newest-first (no pixel bytes). */
    async listForAlert(source: string, identifier: string): Promise<AlertSnapshotMeta[]> {
      const docs = await model
        .find({ source, identifier })
        .select("-png")
        .sort({ capturedAt: -1 })
        .lean()
        .exec();
      return docs.map(toMeta);
    },

    /** The most-recent snapshot metadata for a given kind, or null. */
    async latest(source: string, identifier: string, kind?: AlertSnapshotKind): Promise<AlertSnapshotMeta | null> {
      const q: Record<string, unknown> = { source, identifier };
      if (kind) q.kind = kind;
      const doc = await model.findOne(q).select("-png").sort({ capturedAt: -1 }).lean().exec();
      return doc ? toMeta(doc) : null;
    },

    /** One snapshot's bytes for the media route, or null. */
    async getPng(id: string): Promise<{ data: Buffer; contentType: string; updatedAt: string } | null> {
      // No `.lean()` so Mongoose casts an inline `png` to a real Buffer; the blob
      // store reads disk-first and only falls back to that inline value.
      const doc = await model.findOne({ id }).exec();
      if (!doc) return null;
      const data = await blobs.get(id, doc.png);
      if (!data || !data.length) return null;
      return {
        data,
        contentType: doc.contentType ?? "image/png",
        updatedAt: new Date(doc.capturedAt).toISOString(),
      };
    },

    /**
     * Every snapshot's retention fields, bytes projected away. Deliberately a
     * NARROW projection (not `-png`): the retention sweep walks the whole
     * collection, so it reads five small fields per doc rather than the full
     * metadata. Ordering is unspecified; the planner sorts what it needs.
     */
    async listAllMeta(): Promise<
      {
        id: string;
        source: string;
        identifier: string;
        kind: AlertSnapshotKind;
        layer?: string;
        capturedAt: string;
        width: number;
        height: number;
      }[]
    > {
      const docs = await model
        .find({}, { _id: 0, id: 1, source: 1, identifier: 1, kind: 1, layer: 1, capturedAt: 1, width: 1, height: 1 })
        .lean<
          {
            id: string;
            source: string;
            identifier: string;
            kind: AlertSnapshotKind;
            layer?: string;
            capturedAt: Date;
            width: number;
            height: number;
          }[]
        >()
        .exec();
      return docs.map((d) => ({ ...d, capturedAt: new Date(d.capturedAt).toISOString() }));
    },

    /** Drop specific snapshots (doc + bytes) — the thinning sweep's executor. */
    async deleteMany(ids: string[]): Promise<{ removed: number }> {
      if (!ids.length) return { removed: 0 };
      if (blobs.fs) await blobs.delete(ids);
      const res = await model.deleteMany({ id: { $in: ids } });
      return { removed: res.deletedCount ?? 0 };
    },

    /** Retention: drop snapshots captured before `cutoff` (and their on-disk bytes). */
    async pruneOlderThan(cutoff: Date): Promise<{ removed: number }> {
      if (blobs.fs) {
        const doomed = await model
          .find({ capturedAt: { $lt: cutoff } })
          .select({ id: 1, _id: 0 })
          .lean<{ id: string }[]>();
        await blobs.delete(doomed.map((d) => d.id));
      }
      const res = await model.deleteMany({ capturedAt: { $lt: cutoff } });
      return { removed: res.deletedCount ?? 0 };
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },
  };
}

export type AlertSnapshotRepo = ReturnType<typeof makeAlertSnapshotRepo>;

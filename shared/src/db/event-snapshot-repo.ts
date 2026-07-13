import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { EventSnapshotKind, iEventSnapshotModel } from "./event-snapshot-model";
import type { InlineBlobStore } from "./inline-blob";

/** Snapshot metadata (never ships the pixel bytes). */
export interface EventSnapshotMeta {
  id: string;
  eventId: string;
  source: string;
  kind: EventSnapshotKind;
  layer?: string;
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
export interface EventSnapshotInput {
  eventId: string;
  source: string;
  kind: EventSnapshotKind;
  layer?: string;
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

const toMeta = (doc: any): EventSnapshotMeta => ({
  id: doc.id,
  eventId: doc.eventId,
  source: doc.source,
  kind: doc.kind,
  layer: doc.layer,
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
 * Event-snapshot persistence. Bytes go to the shared FS blob store keyed by the
 * doc id; the metadata doc is byte-free when FS-backed. One doc per `slotKey`
 * (per-hour dedup). Reads split so metadata never ships pixels; `getPng` fetches
 * bytes for the media route. Generic clone of alert-snapshot-repo (event-keyed).
 */
export function makeEventSnapshotRepo(model: Model<iEventSnapshotModel>, blobs: InlineBlobStore) {
  const slotKeyOf = (s: Pick<EventSnapshotInput, "eventId" | "kind" | "layer" | "hourSlot">) =>
    `${s.eventId}:${s.kind}:${s.layer ?? ""}:${s.hourSlot}`;

  return {
    model,

    async put(snap: EventSnapshotInput): Promise<{ id: string }> {
      const slotKey = slotKeyOf(snap);
      const existing = await model.findOne({ slotKey }, { id: 1, _id: 0 }).lean<{ id: string }>().exec();
      const id = existing?.id ?? uuidv4();
      await blobs.put(id, snap.png);
      await model
        .updateOne(
          { slotKey },
          {
            $set: {
              eventId: snap.eventId,
              source: snap.source,
              kind: snap.kind,
              layer: snap.layer,
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

    async listForEvent(eventId: string): Promise<EventSnapshotMeta[]> {
      const docs = await model.find({ eventId }).select("-png").sort({ capturedAt: -1 }).lean().exec();
      return docs.map(toMeta);
    },

    async latest(eventId: string, kind?: EventSnapshotKind): Promise<EventSnapshotMeta | null> {
      const q: Record<string, unknown> = { eventId };
      if (kind) q.kind = kind;
      const doc = await model.findOne(q).select("-png").sort({ capturedAt: -1 }).lean().exec();
      return doc ? toMeta(doc) : null;
    },

    async getPng(id: string): Promise<{ data: Buffer; contentType: string; updatedAt: string } | null> {
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

export type EventSnapshotRepo = ReturnType<typeof makeEventSnapshotRepo>;

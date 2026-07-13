import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * An official resource discovered on an event's contributing sources — a GDACS
 * map, a ReliefWeb situation report, a Copernicus mapping product, a KML/GeoJSON
 * model output. We store the REFERENCE (url + attribution + licence), not the
 * bytes. `rebroadcastSafe` defaults FALSE: most official products are reference
 * links, not cleared for on-air rebroadcast — the on-air surface must gate on it.
 * Deduped on `(eventId, source, url)`. Generic clone of alert-resource.
 */

export type EventResourceKind =
  | "GEOJSON"
  | "KML"
  | "MAP"
  | "IMAGE"
  | "REPORT"
  | "MODEL"
  | "DATA"
  | "SERVICE"
  | "LINK";

export interface iEventResource extends iGeneralModel {
  eventId: string;
  source: string;
  url: string;
  kind: EventResourceKind;
  title?: string;
  description?: string;
  mimeType?: string;
  sourceName?: string;
  attribution?: string;
  license?: string;
  /** Cleared for on-air rebroadcast? Defaults false (reference link only). */
  rebroadcastSafe: boolean;
  contentHash?: string;
  discoveredAt: string;
  lastSeenAt: string;
  /** Linked event_snapshots id when a preview was rendered from this resource. */
  assetId?: string;
}

export interface iEventResourceModel extends iEventResource {
  id: string;
  _id: string;
}

export const EventResourceSchema = new mongoose.Schema<iEventResourceModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    eventId: { type: String, required: true },
    source: { type: String, required: true },
    url: { type: String, required: true },
    kind: { type: String, required: true, default: "LINK" },
    title: { type: String, required: false },
    description: { type: String, required: false },
    mimeType: { type: String, required: false },
    sourceName: { type: String, required: false },
    attribution: { type: String, required: false },
    license: { type: String, required: false },
    rebroadcastSafe: { type: Boolean, required: true, default: false },
    contentHash: { type: String, required: false },
    discoveredAt: { type: String, required: true, default: () => new Date().toISOString() },
    lastSeenAt: { type: String, required: true, default: () => new Date().toISOString() },
    assetId: { type: String, required: false },
  },
  mongoTimestamps,
);

EventResourceSchema.index({ eventId: 1, source: 1, url: 1 }, { unique: true, name: "event_res_dedup_ix" });
EventResourceSchema.index({ eventId: 1, discoveredAt: 1 }, { name: "event_res_event_ix" });

export const getEventResourceModel = (conn: Connection) =>
  getModel<iEventResourceModel>(conn, "EventResource", EventResourceSchema);

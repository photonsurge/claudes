import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached NASA EONET "open" volcano events. Unlike earthquakes/fires (discrete
 * point-in-time detections), a volcano event persists across many polls while
 * it stays active, so the worker UPSERTS on the source `volcanoId` and bumps
 * `fetchedAt` every time it's still in the feed. The TTL is on `fetchedAt`, not
 * on the event's own dates — so an event that simply stops appearing in the
 * "open" feed (closed, or dropped by EONET) ages out instead of needing a
 * full-replace sync.
 */
const TTL_SEC = Number(process.env.VOLCANO_TTL_SEC || 3 * 24 * 60 * 60);

export interface iVolcano extends iGeneralModel {
  /** Source EONET event id (the upsert key). */
  volcanoId: string;
  name: string;
  lat: number;
  lng: number;
  status: string;
  firstDate: Date;
  lastDate: Date;
  sourceUrl?: string;
  fetchedAt: Date;
  loc?: { type: "Point"; coordinates: [number, number] };
}

export interface iVolcanoModel extends iVolcano {
  id: string;
  _id: string;
}

const VolcanoSchema = new mongoose.Schema<iVolcanoModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    volcanoId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    status: { type: String, required: true },
    firstDate: { type: Date, required: true },
    lastDate: { type: Date, required: true },
    sourceUrl: { type: String, required: false },
    fetchedAt: { type: Date, required: true, default: () => new Date() },
    loc: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number] },
    },
  },
  { timestamps: false },
);

VolcanoSchema.index({ volcanoId: 1 }, { unique: true, name: "volcano_id_ix" });
VolcanoSchema.index({ lastDate: -1 }, { name: "volcano_last_date_ix" });
VolcanoSchema.index({ loc: "2dsphere" }, { name: "volcano_geo_ix", sparse: true });
// Auto-expire events that have stopped showing up in the "open" feed.
VolcanoSchema.index({ fetchedAt: 1 }, { name: "volcano_ttl_ix", expireAfterSeconds: TTL_SEC });

export const getVolcanoModel = (conn: Connection) =>
  getModel<iVolcanoModel>(conn, "Volcano", VolcanoSchema);
